window.__ModuleLoader__.load({
  id: "dsh-vault",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useState, useCallback } = React;

    // ---------- 样式（一次性注入，作用域前缀 dv-） ----------
    const CSS = `
.dv-wrap{font-size:13px;line-height:1.55}
.dv-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.dv-title{font-weight:600;font-size:14px}
.dv-pill{border:1px solid rgba(128,128,128,.45);border-radius:999px;padding:1px 9px;font-size:12px;white-space:nowrap}
.dv-pill.ok{border-color:#2e7d32;color:#2e7d32}
.dv-pill.warn{border-color:#b26a00;color:#b26a00}
.dv-pill.err{border-color:#c62828;color:#c62828}
.dv-tabs{display:flex;gap:6px;margin:10px 0;flex-wrap:wrap}
.dv-tab{border:1px solid rgba(128,128,128,.45);background:transparent;border-radius:8px;padding:4px 12px;cursor:pointer;font-size:13px;color:inherit}
.dv-tab.on{border-color:#1565c0;color:#1565c0;font-weight:600}
.dv-table{width:100%;border-collapse:collapse}
.dv-table th,.dv-table td{border-bottom:1px solid rgba(128,128,128,.25);padding:4px 8px;text-align:left;white-space:nowrap}
.dv-table td.dv-note{white-space:normal;max-width:220px}
.dv-badge{border-radius:6px;padding:0 6px;font-size:12px;white-space:nowrap}
.dv-badge.soon{background:rgba(255,152,0,.16);color:#b26a00}
.dv-badge.expired{background:rgba(198,40,40,.13);color:#c62828}
.dv-form{display:grid;grid-template-columns:120px 1fr;gap:8px 10px;align-items:center;max-width:600px;margin-top:4px}
.dv-form label{text-align:right;opacity:.8}
.dv-input{border:1px solid rgba(128,128,128,.45);border-radius:8px;padding:5px 9px;font-size:13px;background:transparent;color:inherit;width:100%;box-sizing:border-box}
.dv-row{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap}
.dv-btn{border:1px solid #1565c0;color:#1565c0;background:transparent;border-radius:8px;padding:5px 14px;cursor:pointer;font-size:13px}
.dv-btn.primary{background:#1565c0;color:#fff}
.dv-btn.danger{border-color:#c62828;color:#c62828}
.dv-btn.small{padding:1px 8px;font-size:12px}
.dv-btn:disabled{opacity:.5;cursor:not-allowed}
.dv-banner{border-radius:8px;padding:7px 11px;margin:10px 0;font-size:13px;white-space:pre-wrap;word-break:break-all}
.dv-banner.ok{background:rgba(46,125,50,.12);color:#2e7d32;border:1px solid rgba(46,125,50,.35)}
.dv-banner.err{background:rgba(198,40,40,.1);color:#c62828;border:1px solid rgba(198,40,40,.35)}
.dv-banner.info{background:rgba(21,101,192,.1);color:#1565c0;border:1px solid rgba(21,101,192,.35)}
.dv-hint{opacity:.65;font-size:12px;margin:6px 0}
.dv-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.dv-audit{max-height:360px;overflow:auto;border:1px solid rgba(128,128,128,.3);border-radius:8px;padding:6px 8px}
.dv-seg{display:inline-flex;border:1px solid rgba(128,128,128,.45);border-radius:8px;overflow:hidden}
.dv-seg button{border:0;background:transparent;padding:4px 12px;cursor:pointer;font-size:13px;color:inherit}
.dv-seg button.on{background:#1565c0;color:#fff}
`;

    let cssInjected = false;
    function ensureCss() {
      if (cssInjected || typeof document === "undefined") return;
      if (document.getElementById("dsh-vault-style")) { cssInjected = true; return; }
      const el = document.createElement("style");
      el.id = "dsh-vault-style";
      el.textContent = CSS;
      document.head.appendChild(el);
      cssInjected = true;
    }

    // ---------- 后端通道：同源 POST /vault ----------
    function apiUrl() {
      const base = typeof document !== "undefined" ? document.baseURI : "/";
      return new URL("./vault", base).toString();
    }
    async function api(method, payload) {
      const res = await fetch(apiUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ method: method }, payload || {})),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || body.message || "HTTP " + res.status);
      return body;
    }

    // ---------- 小部件 ----------
    function Banner({ kind, text }) {
      if (!text) return null;
      return h("div", { className: "dv-banner " + (kind || "info") }, text);
    }

    function statePill(st) {
      if (!st) return null;
      const m = {
        DISABLED: ["warn", "密保未启用"],
        OK: ["ok", "已验证·宽限中"],
        MISSING: ["warn", "待密保验证"],
        EXPIRED: ["warn", "验证已过期"],
      };
      if (String(st).startsWith("LOCKED:")) return h("span", { className: "dv-pill err" }, "锁定 " + st.slice(7) + "s");
      const e = m[st];
      return h("span", { className: "dv-pill " + (e ? e[0] : "") }, e ? e[1] : String(st));
    }

    function expiryBadge(it) {
      if (it.leftDays == null) return h("span", null, it.expires || "长期");
      if (it.leftDays < 0) return h("span", { className: "dv-badge expired" }, "已过期 " + -it.leftDays + " 天");
      if (it.leftDays <= 30) return h("span", { className: "dv-badge soon" }, "剩 " + it.leftDays + " 天");
      return h("span", null, it.expires);
    }

    // ---------- 条目页 ----------
    function EntriesPanel({ onChanged }) {
      const [items, setItems] = useState(null);
      const [err, setErr] = useState("");
      const [info, setInfo] = useState("");
      const [onlySoon, setOnlySoon] = useState(false);
      const [masked, setMasked] = useState({});
      const [busy, setBusy] = useState("");

      const load = useCallback(() => {
        setErr("");
        api("list")
          .then((d) => setItems(d.items || []))
          .catch((e) => setErr(e.message || String(e)));
      }, []);
      useEffect(load, [load]);

      async function doPeek(key) {
        setBusy(key); setInfo(""); setErr("");
        try {
          const d = await api("peek", { key: key });
          setMasked((p) => Object.assign({}, p, { [key]: d.masked }));
        } catch (e) { setErr(e.message || String(e)); }
        setBusy("");
      }
      async function doRm(key) {
        if (typeof window !== "undefined" && !window.confirm("确认删除 " + key + " ？（不可恢复）")) return;
        setBusy(key); setInfo(""); setErr("");
        try {
          const d = await api("rm", { key: key });
          setInfo(d.message || "已删除 " + key);
          setMasked((p) => { const n = Object.assign({}, p); delete n[key]; return n; });
          load();
          onChanged && onChanged();
        } catch (e) { setErr(e.message || String(e)); }
        setBusy("");
      }

      if (err && items == null) return h("div", null, h(Banner, { kind: "err", text: err }));
      if (items == null) return h("div", { className: "dv-hint" }, "加载中…");

      const rows = onlySoon ? items.filter((it) => it.leftDays != null && it.leftDays <= 30) : items;
      return h("div", null,
        h(Banner, { kind: "err", text: err }),
        h(Banner, { kind: "ok", text: info }),
        h("div", { className: "dv-row", style: { marginTop: 0, marginBottom: 8 } },
          h("label", { style: { display: "flex", gap: 4, alignItems: "center" } },
            h("input", { type: "checkbox", checked: onlySoon, onChange: (e) => setOnlySoon(e.target.checked) }),
            "只看 30 天内到期/已过期"),
          h("button", { className: "dv-btn small", onClick: load }, "刷新")),
        rows.length === 0
          ? h("div", { className: "dv-hint" }, onlySoon ? "没有临期条目。" : "库中暂无条目——去「登记」页添加，或让 agent 用 secretctl 登记。")
          : h("table", { className: "dv-table" },
              h("thead", null, h("tr", null,
                h("th", null, "KEY"), h("th", null, "系统"), h("th", null, "账号"),
                h("th", null, "到期"), h("th", null, "录入"), h("th", null, "来源"),
                h("th", null, "备注"), h("th", null, "操作"))),
              h("tbody", null, rows.map((it) =>
                h("tr", { key: it.key },
                  h("td", { className: "dv-mono" }, it.key),
                  h("td", null, it.system || "-"),
                  h("td", null, it.account || "-"),
                  h("td", null, expiryBadge(it)),
                  h("td", null, (it.added || "").slice(0, 10) || "-"),
                  h("td", null, it.source || "-"),
                  h("td", { className: "dv-note" }, masked[it.key] ? h("span", { className: "dv-mono" }, masked[it.key] + " ") : null, it.note || "-"),
                  h("td", null,
                    h("button", { className: "dv-btn small", disabled: busy === it.key, onClick: () => doPeek(it.key) }, "核对"),
                    " ",
                    h("button", { className: "dv-btn small danger", disabled: busy === it.key, onClick: () => doRm(it.key) }, "删除")))))));
    }

    // ---------- 登记页（表单；秘密值只上行、提交即擦） ----------
    const EMPTY_FORM = { key: "", system: "", account: "", expires: "", note: "", value: "", len: "24" };
    function AddPanel({ onAdded }) {
      const [mode, setMode] = useState("add"); // add | gen
      const [f, setF] = useState(EMPTY_FORM);
      const [msg, setMsg] = useState(null); // {kind,text}
      const [busy, setBusy] = useState(false);
      const set = (k) => (e) => setF((p) => Object.assign({}, p, { [k]: e.target.value }));

      // 卸载时擦除秘密值状态
      useEffect(() => () => setF((p) => Object.assign({}, p, { value: "" })), []);

      async function submit() {
        setBusy(true); setMsg(null);
        try {
          let d;
          if (mode === "gen") {
            d = await api("gen", { key: f.key, system: f.system, account: f.account, expires: f.expires, note: f.note, len: Number(f.len) || 24 });
          } else {
            if (!f.value) throw new Error("请输入秘密值（或切换到「本地生成」）");
            d = await api("add", { key: f.key, system: f.system, account: f.account, expires: f.expires, note: f.note, value: f.value });
          }
          setMsg({ kind: "ok", text: (d.message || "完成") + (d.masked ? "（脱敏 " + d.masked + "）" : "") });
          setF(EMPTY_FORM); // 成功即全擦
          onAdded && onAdded();
        } catch (e) {
          setMsg({ kind: "err", text: e.message || String(e) });
          setF((p) => Object.assign({}, p, { value: "" })); // 失败也擦秘密值
        }
        setBusy(false);
      }

      return h("div", null,
        h("div", { className: "dv-row", style: { marginTop: 0 } },
          h("span", { className: "dv-seg" },
            h("button", { className: mode === "add" ? "on" : "", onClick: () => { setMode("add"); setMsg(null); } }, "登记已有值"),
            h("button", { className: mode === "gen" ? "on" : "", onClick: () => { setMode("gen"); setMsg(null); } }, "本地生成（推荐）"))),
        msg ? h(Banner, { kind: msg.kind, text: msg.text }) : null,
        h("div", { className: "dv-form" },
          h("label", null, "KEY *"),
          h("input", { className: "dv-input dv-mono", value: f.key, onChange: set("key"), placeholder: "GITHUB_TOKEN", spellCheck: false, autoComplete: "off" }),
          h("label", null, "用在哪个系统 *"),
          h("input", { className: "dv-input", value: f.system, onChange: set("system"), placeholder: "GitHub", autoComplete: "off" }),
          h("label", null, "账号"),
          h("input", { className: "dv-input", value: f.account, onChange: set("account"), placeholder: "user@example.com（可空）", autoComplete: "off" }),
          h("label", null, "到期日"),
          h("input", { className: "dv-input dv-mono", value: f.expires, onChange: set("expires"), placeholder: "YYYY-MM-DD（空=长期）", autoComplete: "off" }),
          mode === "gen"
            ? [h("label", { key: "l" }, "长度"),
               h("input", { key: "i", className: "dv-input dv-mono", value: f.len, onChange: set("len"), placeholder: "24", autoComplete: "off" })]
            : [h("label", { key: "l" }, "秘密值 *"),
               h("input", { key: "i", className: "dv-input", type: "password", value: f.value, onChange: set("value"), placeholder: "只上行加密入库，任何页面/日志不回显", autoComplete: "new-password", spellCheck: false })],
          h("label", null, "备注"),
          h("input", { className: "dv-input", value: f.note, onChange: set("note"), placeholder: "可空", autoComplete: "off" })),
        h("div", { className: "dv-hint" },
          mode === "gen"
            ? "本地生成：CSPRNG 产生强密钥直接加密入库，明文不出现在浏览器/对话/日志，回执仅显示脱敏值。"
            : "秘密值经本机回环 HTTPS 之外的同源通道直达服务端加密入库；高价值密钥（主账号/支付/云主账号）建议改在自己的终端运行 secretctl add。"),
        h("div", { className: "dv-row" },
          h("button", { className: "dv-btn primary", disabled: busy || !f.key || !f.system || (mode === "add" && !f.value), onClick: submit },
            busy ? "处理中…" : mode === "gen" ? "生成并入库" : "加密入库")));
    }

    // ---------- 密保页 ----------
    function ChallengePanel({ onPassed }) {
      const [info, setInfo] = useState(null);
      const [answers, setAnswers] = useState([]);
      const [msg, setMsg] = useState(null);
      const [busy, setBusy] = useState(false);

      const load = useCallback(() => {
        api("questions")
          .then((d) => { setInfo(d); setAnswers(new Array((d.items || []).length).fill("")); })
          .catch((e) => setMsg({ kind: "err", text: e.message || String(e) }));
      }, []);
      useEffect(load, [load]);

      async function submit() {
        setBusy(true); setMsg(null);
        try {
          const d = await api("challenge", { answers: answers });
          if (d.result === "PASS") {
            setMsg({ kind: "ok", text: "密保通过 ✅ 宽限窗口内 get/use/peek 可用（agent 侧同样放行）" });
            setAnswers((p) => p.map(() => "")); // 擦答案
            onPassed && onPassed();
            load();
          } else {
            setMsg({ kind: "err", text: d.message || d.result });
            setAnswers((p) => p.map(() => ""));
            load();
          }
        } catch (e) { setMsg({ kind: "err", text: e.message || String(e) }); }
        setBusy(false);
      }

      if (!info) return h("div", null, msg ? h(Banner, { kind: msg.kind, text: msg.text }) : null, h("div", { className: "dv-hint" }, "加载中…"));
      if (!info.protected) {
        return h("div", null,
          h(Banner, { kind: "info", text: "密保未启用：当前 get/use/peek 无门槛。" }),
          h("div", { className: "dv-hint" },
            "请在你自己的终端运行 secretctl protect init 设置密保问题（tty 交互输入，答案不经过浏览器与对话）。设置后本页可作答解锁。"));
      }
      return h("div", null,
        h(Banner, { kind: msg ? msg.kind : "info", text: msg ? msg.text : "当前状态: " + info.state + " —— 回答全部问题后提交，通过即进入宽限窗口。" }),
        h("div", { className: "dv-form" },
          (info.items || []).map((q, i) => [
            h("label", { key: "q" + i }, "问题 " + (i + 1)),
            h("div", { key: "a" + i },
              h("div", { style: { marginBottom: 3 } }, q),
              h("input", { className: "dv-input", type: "password", value: answers[i] || "", autoComplete: "off", spellCheck: false,
                onChange: (e) => setAnswers((p) => { const n = p.slice(); n[i] = e.target.value; return n; }) }))])),
        h("div", { className: "dv-hint" }, "连续 5 次答错将锁定 30 分钟（锁定期间正确答案也会被拒绝）。"),
        h("div", { className: "dv-row" },
          h("button", { className: "dv-btn primary", disabled: busy || answers.some((a) => !a), onClick: submit }, busy ? "验证中…" : "提交验证")));
    }

    // ---------- 审计页 ----------
    function AuditPanel() {
      const [items, setItems] = useState(null);
      const [err, setErr] = useState("");
      const load = useCallback(() => {
        setErr("");
        api("audit", { n: 50 })
          .then((d) => setItems(d.items || []))
          .catch((e) => setErr(e.message || String(e)));
      }, []);
      useEffect(load, [load]);
      return h("div", null,
        h(Banner, { kind: "err", text: err }),
        h("div", { className: "dv-row", style: { marginTop: 0 } },
          h("button", { className: "dv-btn small", onClick: load }, "刷新"),
          h("span", { className: "dv-hint" }, "最近 50 条（新→旧）；append-only，仅存动作与 KEY 名，无秘密值")),
        items == null ? h("div", { className: "dv-hint" }, "加载中…")
          : items.length === 0 ? h("div", { className: "dv-hint" }, "暂无审计记录。")
          : h("div", { className: "dv-audit" },
              h("table", { className: "dv-table" },
                h("thead", null, h("tr", null, h("th", null, "时间"), h("th", null, "动作"), h("th", null, "KEY"), h("th", null, "结果"), h("th", null, "来源"))),
                h("tbody", null, items.map((it, i) =>
                  h("tr", { key: i },
                    h("td", { className: "dv-mono" }, (it.time || "").replace("T", " ").slice(0, 19)),
                    h("td", null, it.action),
                    h("td", { className: "dv-mono" }, it.key),
                    h("td", null, it.result),
                    h("td", { className: "dv-mono dv-note" }, it.source)))))));
    }

    // ---------- 根组件 ----------
    function VaultCard() {
      useEffect(() => { ensureCss(); }, []);
      const [tab, setTab] = useState("entries");
      const [status, setStatus] = useState(null);
      const [err, setErr] = useState("");

      const reload = useCallback(() => {
        api("status")
          .then((d) => { setStatus(d); setErr(""); })
          .catch((e) => setErr(e.message || String(e)));
      }, []);
      useEffect(() => { reload(); }, [reload]);

      const tabs = [["entries", "条目"], ["add", "登记"], ["challenge", "密保"], ["audit", "审计"]];
      return h("div", { className: "dv-wrap" },
        h("div", { className: "dv-head" },
          h("span", { className: "dv-title" }, "🔐 密钥库"),
          status
            ? [h("span", { key: "1", className: "dv-pill " + (status.initialized ? "ok" : "err") }, status.initialized ? "库就绪" : "未初始化"),
               status.initialized ? h("span", { key: "2", className: "dv-pill" }, status.entries + " 条") : null,
               statePill(status.challengeState)]
            : null),
        err ? h(Banner, { kind: "err", text: err + "\n（若为 404：插件主机侧未加载——重启 dsh web 后再刷新本页）" }) : null,
        status && !status.initialized && !err
          ? h(Banner, { kind: "info", text: "密钥库未初始化：终端运行 secretctl init（并立即 secretctl backup-key 备份主密钥）。" })
          : null,
        h("div", { className: "dv-tabs" }, tabs.map((t) =>
          h("button", { key: t[0], className: "dv-tab" + (tab === t[0] ? " on" : ""), onClick: () => setTab(t[0]) }, t[1]))),
        tab === "entries" ? h(EntriesPanel, { onChanged: reload }) : null,
        tab === "add" ? h(AddPanel, { onAdded: reload }) : null,
        tab === "challenge" ? h(ChallengePanel, { onPassed: reload }) : null,
        tab === "audit" ? h(AuditPanel, null) : null);
    }

    // ---------- slot 注册 ----------
    const inject = ["slots"];
    // rc.6 列表 slot 需要 id；rc.7+ keyed slot 需要 key。两个都传。
    function registerSlot(slots, options, component) {
      const next = Object.assign({}, options);
      if (next.id == null && next.key != null) next.id = String(next.key);
      if (next.key == null && next.id != null) next.key = next.id;
      return slots.register(next, component);
    }
    function apply(ctx) {
      const slots = ctx.slots;
      if (!slots) return;
      slots.inject("settings.plugin.item", () => registerSlot(
        slots,
        { name: "settings.plugin.item", key: "dsh-vault" },
        VaultCard,
      ));
    }

    return { inject: inject, apply: apply };
  },
});
