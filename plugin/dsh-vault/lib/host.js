// dsh-vault host — secretctl(sops+age) 密钥库的 GUI 后端
// 通道：webServer.register 同源路由 POST /vault（{method, ...}），无 CORS 面
// 安全边界：
//   - add/gen/rm/challenge/peek 仅限回环来源（LAN 直连浏览器只读元数据）
//   - 秘密值只经子进程 stdin 传给 secretctl，绝不进 argv/日志/响应
//   - 响应只含元数据、脱敏值与状态；明文永不回流浏览器
//   - 所有落库/校验仍由 secretctl 执行（单一事实源，CLI 与 GUI 同一套门槛与审计）
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Schema from '@deepseek-ai/schemastery';

export const name = 'dsh-vault';
export const inject = ['settings'];
export const Config = Schema.object({});

const HOME = process.env.HOME || homedir();
const CTL = join(HOME, '.local', 'bin', 'secretctl');
const STORE_DIR = join(HOME, '.config', 'secret-store');
const STORE = join(STORE_DIR, 'secrets.enc.yaml');
const META = join(STORE_DIR, 'metadata.tsv');
const AUDIT = join(STORE_DIR, 'audit.log');
const CHAL = join(STORE_DIR, 'challenge.json');
const PASSF = join(STORE_DIR, '.challenge-pass');
const CHILD_ENV = {
  ...process.env,
  PATH: [join(HOME, '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
};
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- 基础工具 ----
function ctl(args, stdinText, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out, err });
    };
    const p = spawn(CTL, args, { env: CHILD_ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch {}
      finish(-1);
    }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { err += '\n' + String(e?.message || e); finish(-1); });
    p.on('close', (code) => finish(code ?? -1));
    p.stdin.on('error', () => {});
    p.stdin.end(stdinText == null ? undefined : String(stdinText));
  });
}

function sendJson(res, code, obj) {
  const data = JSON.stringify(obj);
  try {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(data),
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {}
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) {
        reject(new Error('body too large'));
        try { req.destroy(); } catch {}
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function isLoopback(req) {
  const a = req?.socket?.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function lastLine(txt, prefer) {
  const lines = String(txt || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return '';
  if (prefer) {
    const hit = lines.find((l) => prefer.test(l));
    if (hit) return hit;
  }
  return lines[lines.length - 1];
}

function metaEntries() {
  if (!existsSync(META)) return [];
  const out = [];
  for (const line of readFileSync(META, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const f = line.split('\t');
    out.push({
      key: f[0] || '',
      system: f[1] || '',
      account: f[2] || '',
      expires: f[3] || '长期',
      added: f[4] || '',
      source: f[5] || '',
      note: f[6] || '',
    });
  }
  return out;
}

function challengeState() {
  if (!existsSync(CHAL)) return 'DISABLED';
  try {
    const d = JSON.parse(readFileSync(CHAL, 'utf8'));
    const now = Date.now() / 1000;
    if (Number(d.lock_until) > now) return 'LOCKED:' + Math.ceil(Number(d.lock_until) - now);
    const ts = parseInt(readFileSync(PASSF, 'utf8').trim(), 10);
    if (!Number.isFinite(ts)) return 'MISSING';
    const grace = Number(d.grace_sec) > 0 ? Number(d.grace_sec) : 300;
    return now - ts <= grace ? 'OK' : 'EXPIRED';
  } catch {
    return 'MISSING';
  }
}

// ---- 字段校验（失败→400，不抛 500） ----
function bad(res, msg) {
  return sendJson(res, 400, { ok: false, error: msg });
}
function checkKey(res, body) {
  const key = String(body.key || '').trim();
  if (!KEY_RE.test(key) || key === '_STORE_VERSION') {
    bad(res, 'KEY 不合法：字母/数字/下划线、字母或下划线开头、≤64 位、非保留名');
    return null;
  }
  return key;
}
function checkSystem(res, body) {
  const s = String(body.system || '').replace(/[\t\r\n]+/g, ' ').trim();
  if (!s || s.length > 64) {
    bad(res, '「用在哪个系统」必填且 ≤64 字');
    return null;
  }
  return s;
}
function checkExpires(res, body) {
  const e = String(body.expires || '').trim();
  if (e && !DATE_RE.test(e)) {
    bad(res, '到期日格式应为 YYYY-MM-DD（或留空=长期）');
    return null;
  }
  return e;
}
function optField(res, v, max, label) {
  const s = String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  if (s.length > max) {
    bad(res, `${label} 超长（≤${max} 字）`);
    return null;
  }
  return s;
}

// ---- /vault 请求分发 ----
async function handleApi(req, res) {
  try {
    let body = {};
    if (req.method === 'POST') {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } else if (req.method === 'GET') {
      body = Object.fromEntries(new URL(req.url || '/', 'http://127.0.0.1').searchParams);
    } else {
      return sendJson(res, 405, { ok: false, error: 'method not allowed' });
    }
    const m = String(body.method || 'status');
    const sensitive = new Set(['add', 'gen', 'rm', 'challenge', 'peek']);
    if (sensitive.has(m) && !isLoopback(req)) {
      return sendJson(res, 403, { ok: false, error: '该操作仅限本机回环访问（LAN 直连仅可只读元数据）' });
    }

    switch (m) {
      case 'status':
        return sendJson(res, 200, {
          ok: true,
          initialized: existsSync(STORE),
          protected: existsSync(CHAL),
          challengeState: challengeState(),
          entries: metaEntries().length,
          storeDir: STORE_DIR,
          ctlExists: existsSync(CTL),
        });

      case 'list':
      case 'expiry': {
        const items = metaEntries();
        const now = Date.now();
        for (const it of items) {
          if (it.expires !== '长期' && DATE_RE.test(it.expires)) {
            const t = new Date(it.expires + 'T23:59:59').getTime();
            it.leftDays = Number.isFinite(t) ? Math.ceil((t - now) / 86400000) : null;
          } else {
            it.leftDays = null;
          }
        }
        if (m === 'list') return sendJson(res, 200, { ok: true, items, challengeState: challengeState() });
        const days = Math.min(Math.max(parseInt(body.days, 10) || 30, 1), 3650);
        return sendJson(res, 200, {
          ok: true,
          days,
          items: items.filter((it) => it.leftDays != null && it.leftDays <= days),
        });
      }

      case 'questions': {
        if (!existsSync(CHAL)) return sendJson(res, 200, { ok: true, protected: false, state: 'DISABLED', items: [] });
        const d = JSON.parse(readFileSync(CHAL, 'utf8'));
        return sendJson(res, 200, {
          ok: true,
          protected: true,
          state: challengeState(),
          items: (d.questions || []).map((q) => String(q.q || '')),
        });
      }

      case 'challenge': {
        const answers = Array.isArray(body.answers) ? body.answers.map((a) => String(a ?? '')) : [];
        if (!answers.length || answers.length > 5) return bad(res, '答案数量不合法');
        if (answers.some((a) => !a)) return bad(res, '存在空答案');
        const r = await ctl(['challenge', '--stdin'], answers.join('\n') + '\n');
        const txt = r.out + '\n' + r.err;
        let result = 'ERR';
        let mm;
        if (/密保通过/.test(r.out)) result = 'PASS';
        else if ((mm = txt.match(/已锁定\s*(\d+)\s*秒/)) || (mm = txt.match(/锁定（剩余\s*(\d+)\s*秒）/))) result = 'LOCKED:' + mm[1];
        else if ((mm = txt.match(/剩余尝试次数:\s*(\d+)/))) result = 'FAIL:' + mm[1];
        return sendJson(res, 200, {
          ok: r.code === 0,
          result,
          message: lastLine(txt, /密保通过|答案错误|锁定/) || result,
          challengeState: challengeState(),
        });
      }

      case 'add': {
        const key = checkKey(res, body); if (!key) return;
        const system = checkSystem(res, body); if (!system) return;
        const expires = checkExpires(res, body); if (expires === null) return;
        const account = optField(res, body.account, 128, '账号'); if (account === null) return;
        const note = optField(res, body.note, 256, '备注'); if (note === null) return;
        const value = typeof body.value === 'string' ? body.value : '';
        if (!value) return bad(res, '秘密值为空');
        if (value.length > 8192) return bad(res, '秘密值超长（≤8192 字符）');
        if (value.includes('\n')) return bad(res, '暂不支持多行值（证书/私钥请先 base64 单行化，或走终端 secretctl add）');
        const args = ['add', key, '--system', system, '--source', 'gui', '--stdin'];
        if (account) args.push('--account', account);
        if (expires) args.push('--expires', expires);
        if (note) args.push('--note', note);
        const r = await ctl(args, value);
        return sendJson(res, 200, {
          ok: r.code === 0,
          message: lastLine(r.code === 0 ? r.out : r.err || r.out, /已登记|secretctl:/),
        });
      }

      case 'gen': {
        const key = checkKey(res, body); if (!key) return;
        const system = checkSystem(res, body); if (!system) return;
        const expires = checkExpires(res, body); if (expires === null) return;
        const account = optField(res, body.account, 128, '账号'); if (account === null) return;
        const note = optField(res, body.note, 256, '备注'); if (note === null) return;
        const len = Math.min(Math.max(parseInt(body.len, 10) || 24, 12), 128);
        const args = ['gen', key, '--system', system, '--len', String(len)];
        if (account) args.push('--account', account);
        if (expires) args.push('--expires', expires);
        if (note) args.push('--note', note);
        const r = await ctl(args);
        const masked = (r.out.match(/脱敏=(\S+)/) || [])[1] || '';
        return sendJson(res, 200, {
          ok: r.code === 0,
          masked,
          message: lastLine(r.code === 0 ? r.out : r.err || r.out, /已生成|secretctl:/),
        });
      }

      case 'peek': {
        const key = checkKey(res, body); if (!key) return;
        const r = await ctl(['peek', key]);
        if (r.code === 0) return sendJson(res, 200, { ok: true, masked: r.out.trim() });
        return sendJson(res, 200, { ok: false, error: lastLine(r.err || r.out, /secretctl:/) || 'peek 失败' });
      }

      case 'rm': {
        const key = checkKey(res, body); if (!key) return;
        const r = await ctl(['rm', key]);
        return sendJson(res, 200, {
          ok: r.code === 0,
          message: lastLine(r.code === 0 ? r.out : r.err || r.out, /已删除|secretctl:/),
        });
      }

      case 'audit': {
        const n = Math.min(Math.max(parseInt(body.n, 10) || 30, 1), 200);
        if (!existsSync(AUDIT)) return sendJson(res, 200, { ok: true, items: [] });
        const lines = readFileSync(AUDIT, 'utf8').split('\n').filter((l) => l.trim());
        const items = lines.slice(-n).reverse().map((l) => {
          const f = l.split('\t');
          return { time: f[0] || '', action: f[1] || '', key: f[2] || '', result: f[3] || '', source: f[4] || '' };
        });
        return sendJson(res, 200, { ok: true, items });
      }

      default:
        return bad(res, '未知 method: ' + m.slice(0, 40));
    }
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: String(e?.message || e).slice(0, 300) });
  }
}

export function apply(ctx, config) {
  // 同源 HTTP RPC（浏览器 fetch("./vault")，无 CORS/端口暴露）
  ctx.inject(['webServer'], (c) => {
    c.webServer.register({
      kind: 'exact',
      path: '/vault',
      handler: (req, res) => { void handleApi(req, res); },
    });
  });
  // 必须按包名登记 settings 命名空间，否则 settings.plugin.item 卡片不会被 dispatch
  ctx.inject(['settings'], (c) => {
    c.settings.register('dsh-vault', Config, { base: config });
  });
}
