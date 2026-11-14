# GUI 表单实现方案（client UI 插件）

> **实施状态（2026-11-04）：路径②（正式 npm 包）已实现并装机** —— `plugin/dsh-vault/`
> 已安装到 `~/.dsh/profiles/web/node_modules/dsh-vault`（profile 的 dependencies + bundles 已登记）。
> 预演验证全过：host ESM 解析/导出形状 ✓、client 工厂接线（`settings.plugin.item` 注册）✓、
> JSON/YAML/语法 ✓。**待用户重启 dsh web 后做真机验收**（`scripts/restart-dsh-web.sh`）。
> 实际接线比本方案预期更简单：RPC 未用 Typert remote，而是 skillhub 同款
> `ctx.inject(['webServer']) → server.register({kind:'exact', path:'/vault'})` 同源路由，零 CORS。
>
> 配套 [设计文档](设计文档.md) §8.2 与 [用户流程与部署清单](用户流程与部署清单.md) §3。
> 本篇所有机制均已在本机 DSH 检出（0.1.0-rc.7）与 `~/.dsh/profiles/web/` 实装环境中核实，
> 其中 **`@cocofhu/skillhub` 是本机已运行的"第三方插件 + 自带 GUI"成功先例**，包形态直接参照。

---

## 1. 结论：GUI 表单 = 插件包的"浏览器半"，不需要动 DSH 源码

DSH Web 的 GUI 由 cordis 客户端插件体系驱动：

- 浏览器侧模块经 `window.__ModuleLoader__.load({id, factory})` 装载（`dsh-client-modules`）；
  Node 侧扫描启用的 loader 条目，发现声明了 `dsh.client` 的包，解析其 `exports["./client"]`，
  把构建产物经 `/plugins` 路由送进浏览器启动图。
- UI 挂载点是 **slot 注册表**（`dsh-client-ui-slots`）：插件用 `ctx.slots.inject(slotName, cb)`
  向已声明的 slot 贡献 React 组件。本机已验证存在的 slot（从各包 lib 中枚举）：
  `root`、`sidebar`、`sidebar.footer.action`、`sidebar.workspaces`、`sidebar.settings`、
  `conversation`、`conversation.composer`、`conversation.input.dock`、`conversation.input.overlay`、
  `conversation.chat.node`、`conversation.session.header.actions`、`conversation.view`、
  `settings.section`（每功能一页）、`settings.plugin.item`、`settings.plugins.tab`、
  `settings.onboarding`、`settings.action`、`shell.overlay`（框架级悬浮席位，ui-cordis 在用）、
  `tool.call.toolview`（工具卡片自定义渲染，skillhub 在用）。
- 浏览器 ↔ 主机通信：`ctx.connection`（`/api` HTTP unary + 两条下行 WebSocket），
  带信任栅栏——回环地址全通，LAN 需 `trustedHosts`；`settings.*` 与 `credentials.*`
  这类敏感配置面**钉死 loopback**。下行事件经 `ctx.remote.$on` 订阅。

所以 vault 的三个 GUI（解锁对话框、新增条目表单、保险库浏览页）都是
**dsh-vault 这一个 npm 包里的浏览器半组件**，随 host 半一起安装，零改 DSH 源码。

## 2. 包形态（对照 skillhub 实装文件）

```
dsh-vault/
├── package.json
│   {
│     "name": "dsh-vault",
│     "main": "lib/host.js",
│     "exports": {
│       ".":                 "./lib/host.js",
│       "./client":          "./lib/client.js",
│       "./cordis.patch.yml":"./cordis.patch.yml",
│       "./package.json":    "./package.json"
│     },
│     "dsh": {
│       "bundle": { "patch": "./cordis.patch.yml" },
│       "client": {
│         "platform": "web",
│         "inject": [                      // 浏览器 factory 里可 require 的共享模块
│           "@deepseek-ai/dsh-client-runtime",
│           "@deepseek-ai/dsh-client-ui-slots",
│           "@deepseek-ai/dsh-client-ui-settings"
│         ]
│       }
│     }
│   }
├── cordis.patch.yml          # 主机半装载条目（skillhub 同款）：
│   - insert:
│       - id: dsh-vault
│         name: dsh-vault
├── lib/
│   ├── host.js               # cordis apply(ctx)：vault 服务、ctx.tools.register、
│   │                         #   settings namespace schema(schemastery)、审计、巡检 job、
│   │                         #   client RPC 端点（见 §5）
│   ├── client.js             # 浏览器半构建产物（见 §6 骨架；skillhub 用纯
│   │                         #   React.createElement，无需 JSX 编译链）
│   ├── vault-core.js         # 加解密/Argon2id/Shamir（host 半与 CLI 共用）
│   └── cli.js                # dsh-vault 命令行（终端直用，主密码走 tty）
└── scripts/build-client.mjs  # esbuild 打包浏览器半（external: react 等 inject 模块）
```

**安装部署**（与本机 weixin/lark/skillhub 插件同一通道）：

1. `npm pack` 出 tarball → 放入 `~/.local/share/dsh-plugin-archives/`（或直接 `file:` 指向本地目录）；
2. 编辑 `~/.dsh/profiles/web/package.json`：`dependencies` 加 `"dsh-vault": "file:..."`，
   `dsh.profile.bundles` 数组加 `"dsh-vault"`；
3. 在 `~/.dsh/profiles/web/` 下 `pnpm install`（该目录是 hoisted linker 的独立 workspace）；
4. 重启 `dsh web` → loader 树合入我们的 `cordis.patch.yml` 条目，浏览器启动图带上 client bundle。

**开发迭代注意**：client HMR 接收端（`dsh-client-hmr`）始终挂载，但本运行时是安装型检出
（无 src、无法跑 `pnpm run dev:web` watcher），所以**改完 `lib/client.js` 需刷新页面**；
改 host 半需重启 `dsh web`。原型期可先用 §7 的动态包路径免打包迭代。

## 3. 三个界面分别挂在哪

| 界面 | 挂载点 | 交互 |
|---|---|---|
| **保险库主页**（浏览表格 + 新增表单入口 + 配置） | `settings.section` 注册一页「保险库」（或按 skillhub 方式经 `settings.plugin.item` 进入） | 表格只读元数据；行操作：复制/编辑/作废；右上「新增条目」打开表单 |
| **新增条目表单** | 主页内弹层（React portal 到 body 的 modal，组件自有，不占额外 slot） | 见 §4.1 |
| **解锁对话框** | 两个触发点：① `sidebar.footer.action` 常驻锁态按钮 🔒/🔓（skillhub 已验证该 slot 第三方可用）；② 任何 vault RPC 返回 `locked` 错误时自动弹出 | 见 §4.2 |
| 到期提醒（MVP） | 不走 GUI：巡检 job 经对话框/IM 通道推送（weixin/wecom/lark/qqbot 通道本机已装） | P2 再加 GUI 提醒卡 |

备选：若希望解锁框全局悬浮（跨页面可达），用 `shell.overlay`（ui-cordis 的全局面板先例）。

## 4. 表单实现细节

### 4.1 新增条目表单（秘密录入路径 C，全程不经模型）

```
┌─ 新增条目 ─────────────────────────────┐
│ 系统*      [GitHub            ▾]       │  ← datalist 复用既有 system 值
│ 网址       [https://github.com ]       │
│ 账号       [user@example.com   ]       │
│ 类型*      (密码|API key|SSH|TOTP|其他)│
│ 秘密*      [••••••••••••••••••] 👁 ⧉  │  ← input type=password, autoComplete="off"
│            [ 或: 从文件读取… ]          │    粘贴板读取按钮(⧉)需用户点击授权
│ 有效期     [2026-12-31] (可空=长期)     │
│ 别名/标签  [gh 令牌] [work,ci]          │
│ 备注       [不含明文                ]   │
│           [ 生成强密码 ]  [ 取消 ][ 保存 ]│
└────────────────────────────────────────┘
```

实现要点：

- 提交走 **client→host 直连 RPC**（§5），host 收到即调 vault-core 加密落盘；
  响应只含 `{id, masked, fingerprint, strength}` → 表单弹层关闭并显示脱敏回执。
- **内存卫生**：提交成功/取消后立即 `setSecret("")` 清组件 state；secret 字段
  `autoComplete="off"`、不进任何 draft 持久化（绝不写 localStorage / settings scope）；
  「生成强密码」按钮走 host 端 CSPRNG，生成值直接入库并可选送剪贴板，不回填到可见输入框。
- 表单校验在浏览器做基础项（必填/日期格式），权威校验在 host（schemastery schema 同一份）。

### 4.2 解锁对话框（主密码绕过模型的关键件）

```
┌─ 解锁保险库 ───────────────┐
│ 主密码 [••••••••••••]      │   input type=password；错误抖动 + 剩余尝试提示
│ ☐ 本次浏览器会话内保持解锁  │   [ 取消 ] [ 解锁 ]
└────────────────────────────┘
```

- 触发：锁态按钮点击、或任一 vault RPC 抛 `locked`（client 侧统一拦截器自动弹框，
  弹框成功后重放原请求）。
- 提交 → host：Argon2id 派生 → 解开 age 私钥包裹层 → 私钥驻留 host 进程内存，
  启动空闲计时（默认 15 分钟，settings 可配）→ 到期 zeroize 并广播 `vault/lock-state` 事件，
  所有页面的锁态按钮同步变 🔒。
- 连续 5 次失败：host 锁定 30 分钟，对话框显示倒计时，同时审计记红条。

### 4.3 保险库浏览页

- 表格列：系统 / 账号 / 类型 / 有效期（临期高亮）/ 录入时间 / 来源 / 标签；数据来自
  `vault.entry.list` RPC（仅元数据），支持前端过滤排序。
- 行操作：
  - **复制**：页内二次确认（+可要求重答一题密保，settings 开关）→ host 调 CLI 解密→写剪贴板
    →60s 自清；页面只显示"已复制"toast，**明文不回流浏览器**；
  - **编辑**：只允许改元数据（系统/别名/有效期/标签/备注），改秘密必须走"轮换"（新值加密替换，旧版进历史）；
  - **作废**：确认对话框 + 审计。
- 页面上永远没有明文，也没有密文（密文只在 host 磁盘/云端）。

## 5. client ↔ host 通信面（RPC 设计)

对齐官方先例（`pluginInventory/list` 的 Typert 直接 Remote、`settings.*`/`credentials.*`
的 loopback 钉扎）：

| 端点 | 方向 | 信任级别 |
|---|---|---|
| `vault.status`（锁态/条目数/临期数） | client→host unary | loopback + trustedHosts 均可 |
| `vault.entry.list` / `vault.entry.upsert` / `vault.entry.revoke`（元数据） | client→host | 同上 |
| `vault.unlock` / `vault.lock`（主密码只在请求体，一次性） | client→host | **仅 loopback**（对齐 credentials 先例） |
| `vault.clipboard.copy`（id + 出口参数，无秘密正文） | client→host | **仅 loopback** |
| `vault/lock-state`、`vault/expiry-reminder` | host→client 事件 | 经 `ctx.remote.$on` 转发（dsh-api-remotes 白名单模式） |

配置类数据（云存储端点、锁定超时、IM 白名单、密保问题**题面**）走官方 settings 面：
host 用 schemastery 声明 `dsh-vault` namespace schema，client 用
`ctx.settingsScope.bind()` + `dsh-client-schema-form` 的草稿助手
（`setPath/deletePath/hasPath/validateDraft`）渲染配置表单——校验器与 host 是同一份
wire schema，浏览器校验永不偏离服务端。**密保答案与主密码不进 settings**（settings
文件是明文配置面），只进 Argon2id 哈希库。

> M2 落码前的一个 spike 项：第三方包注册自有 Typert remote 的确切接线
> （dsh-api-remotes 组合方式）；skillhub 的替代做法是 host 半直接起 loopback HTTP API。
> 两条路都在信任栅栏内，选型不影响上层表单实现。

## 6. 浏览器半代码骨架（skillhub 同构，纯 createElement 即可，无需 JSX 工具链）

```js
// lib/client.js —— esbuild 产物形态（或手写）
window.__ModuleLoader__.load({
  id: "dsh-vault",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const CSS = `.dsv-root{color:var(--dsw-alias-label-primary,inherit);max-width:920px}
      .dsv-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:grid;place-items:center;z-index:90}
      .dsv-card{background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);
        border-radius:12px;padding:16px;width:min(480px,92vw)}
      /* …表格/表单/toast 样式，全部用 --dsw-alias-* 设计令牌适配深浅主题… */`;

    function UnlockModal({ rpc, onDone, onClose }) { /* 主密码字段 + vault.unlock + 失败计数 */ }
    function EntryForm({ rpc, onSaved })          { /* §4.1 字段 + 提交后清 state */ }
    function VaultPage({ ctx }) {
      // settings.section 主页：锁态条 + 条目表格 + [新增条目] + 配置子表单
      // RPC locked 错误 → 自动弹 UnlockModal → 解锁后重放
    }
    function LockButton({ ctx }) { /* sidebar.footer.action 的 🔒/🔓 + 事件订阅 */ }

    function apply(ctx) {
      const style = document.createElement("style");
      style.textContent = CSS; document.head.appendChild(style);       // 卸载时移除
      const d1 = ctx.slots.inject("settings.section",     () => ctx.slots.register(/*…*/, VaultPage));
      const d2 = ctx.slots.inject("sidebar.footer.action",() => ctx.slots.register(/*…*/, LockButton));
      return () => { d1(); d2(); style.remove(); };
    }
    return { apply };
  },
});
```

主机半骨架：

```js
// lib/host.js
import { Schema } from "schemastery";
export const config = Schema.object({ /* 云端点、锁定分钟数、白名单…（无秘密） */ });

export function apply(ctx) {
  const core = createVaultCore(dataDir);        // vault-core.js：age/Argon2/审计/巡检
  ctx.provide("vaultService", core);            // 供 RPC 端点与工具共用
  ctx.tools.register({ /* vault_register、vault_use… 见设计文档 §8.1 */ });
  registerVaultRemotes(ctx, core);              // §5 RPC 面；unlock/copy 钉 loopback
  registerExpiryJob(ctx, core);                 // 每日巡检 → 对话/IM 推送提醒
}
```

## 7. 开发路径：先动态原型，后正式包

| 路径 | 机制 | 优点 | 限制 | 用于 |
|---|---|---|---|---|
| **① 动态 cordis 包（原型，当天可跑）** | 模型调 `cordis_define` 写 host 半 + 浏览器半源码 → `cordis_run` → 全局 overlay 面板**人工批准** → 浏览器半装入页面 seat | 零打包、零重启、改完即看；批准闸门天然防模型私自挂 UI | 注册表只在内存：进程重启即消失，须重新 run；host 半在 vm 沙箱（Node 全局被重定向，靠 `ctx.fs/bash/web` façade） | 验证表单布局与交互流 |
| **② 正式 npm 包（§2）** | profile 安装 + bundles 声明 | 持久、随 dsh web 启动、可分发（npm/tarball） | 改 client 需刷新页面、改 host 需重启 | MVP 交付形态 |

推荐节奏：用①把"解锁对话框 + 新增表单 + 浏览页"三个交互在一两天内跑给人看 →
确认布局后固化进②的 `lib/client.js`。（①的 host 半 vm 沙箱不能长期持有私钥内存态，
所以原型阶段解锁可先简化为会话内内存变量，正式包再落 §4.2 全量机制。）

## 8. 验收清单（GUI 部分，对应设计文档 M2）

- [ ] 浏览器半随 `dsh web` 启动自动装载，设置面板出现「保险库」页，侧栏出现锁态按钮；
- [ ] 主密码从输入到解锁全程：对话流无该字符串、会话日志 grep 无命中、`/api` 之外无网络请求；
- [ ] 新增表单提交后：组件 state 中 secret 为空串；host 落盘文件为 age 密文；页面显示脱敏回执；
- [ ] 浏览页任何状态下（含 DevTools 内存快照）不存在秘密明文；复制出口 60s 后剪贴板被覆写；
- [ ] LAN 浏览器（trustedHosts）可浏览元数据，但 `vault.unlock`/`vault.clipboard.copy` 被 loopback 栅栏拒绝；
- [ ] 锁定超时后所有已开页面的锁态按钮经事件同步变 🔒，下一次操作自动弹解锁框。
