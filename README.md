# dsh-vault（密码小程序）

> 📦 npm 包名已改为 **`@forfeeling/dsh-vault`**（unscoped `dsh-vault` 被他人占用）。安装：`dsh plugin add @forfeeling/dsh-vault`

DeepSeek Harness（DSH）的零知识密钥保险库：通过 IM、对话、GUI 表单或 CLI 登记密码 / API key / token，
sops+age 加密落盘，调取需密保挑战，**明文永不进入模型上下文、浏览器与日志**。

## 组成

| 组件 | 位置 | 说明 |
|---|---|---|
| `secretctl` | `bin/secretctl` | 核心 CLI：加密库管理（登记/生成/盘点/调取/密保/审计/到期巡检） |
| `dsh-vault` 插件 | `plugin/dsh-vault/` | DSH Web GUI：设置页「🔐 密钥库」卡片（条目/登记/密保/审计四页签），同源 `/vault` RPC，零 CORS |
| `secret-store` skill | `skills/secret-store/` | agent 行为规范：明文不回显、注入式使用、密保挑战编排等铁律 |
| 设计文档 | `docs/` | 威胁模型、方案选型、用户旅程、GUI 实现、轻量方案落地记录 |

## 快速开始

依赖：Linux + python3 + [sops](https://github.com/getsops/sops) ≥ 3.13 + [age](https://github.com/FiloSottile/age)（放 `~/.local/bin`，无 root 也可用静态二进制）。

```bash
# 1. 安装 CLI 并初始化密钥库（自动生成 age 主密钥）
cp bin/secretctl ~/.local/bin/ && chmod +x ~/.local/bin/secretctl
secretctl init
secretctl backup-key      # ⚠️ 立即离线备份主密钥——丢失即全库永久不可解

# 2.（推荐）启用密保问题：调取类操作需先答题，5 次错答锁定 30 分钟
secretctl protect init

# 3. 登记密钥
secretctl gen GITHUB_TOKEN --system GitHub --len 24        # 本地生成，明文全程不出现
printf '%s' '已有密钥' | secretctl add MY_KEY --system 某系统 --stdin

# 4. 安装 agent skill（让 DSH 对话安全地使用密钥库）
mkdir -p ~/.dsh/skills/secret-store && cp skills/secret-store/SKILL.md ~/.dsh/skills/secret-store/

# 5.（可选）安装 GUI 插件
cp -r plugin/dsh-vault ~/.dsh/profiles/web/node_modules/@forfeeling/dsh-vault
# 在 ~/.dsh/profiles/web/package.json 中：
#   dependencies 加 "@forfeeling/dsh-vault": "file:node_modules/@forfeeling/dsh-vault"
#   dsh.profile.bundles 数组加 "@forfeeling/dsh-vault"
# 重启 dsh web（参考 scripts/restart-dsh-web.sh）→ 设置 → 插件 → 🔐 密钥库
```

## 安全模型（摘要）

- 秘密值经 sops+age（X25519）加密落盘；磁盘仅密文 + 低敏元数据（KEY 名/系统/到期）；
- 秘密值永不作为命令行参数；明文临时文件登记并 shred；agent 使用一律 `secretctl use -- 'cmd $KEY'` 环境变量注入；
- 密保答案 scrypt 加盐哈希；通过后 300s 宽限窗口；`get/use/peek` 受门槛，登记与盘点不受；
- append-only 审计日志记录全部登记/调取/密保事件（不含秘密值）；
- GUI 写操作仅限回环来源；明文不回流浏览器（最多前3后4脱敏）。

详见 [docs/设计文档.md](docs/设计文档.md)（威胁模型 T1–T10 与对策、方案选型、密码学细节）。

## 文档

- [设计文档](docs/设计文档.md) —— 威胁模型、零知识 E2EE 选型、核心流程、DSH 集成、路线图与验收标准
- [用户流程与部署清单](docs/用户流程与部署清单.md) —— 完整用户旅程（含对话示例）、应用与服务清单
- [GUI 表单实现方案](docs/GUI表单实现方案.md) —— client UI 插件落地实现（含第三方插件接线实证）
- [轻量方案落地记录](docs/轻量方案-sops-age.md) —— secretctl 用法、7 条设计踩坑、13 步验收证据

## 状态

- [x] M0 设计文档
- [x] 层级 1 轻量方案（sops + age + secretctl + secret-store skill）
- [x] M1 功能内核 —— secretctl v0.2：密保挑战 / 审计 / 本地生成 / 脱敏出口 / 到期巡检（13 步验收通过）
- [x] M1p GUI 插件 —— `dsh-vault` 已装机并通过后端真机验收（`/vault` RPC、启动图 bundle、校验链）
- [ ] M2 云同步自动化 + 到期主动推送（GUI/IM）
- [ ] M3 代用增强 + TOTP + 多保险库

## 验收

- CLI：`scripts/test-secretctl.sh` 13 步全链路（⚠️ 会清空重建 `~/.config/secret-store`，存有真实密钥时勿运行）
- 重启工具：`scripts/restart-dsh-web.sh`（先验证 node/参数后才杀进程，从 /proc 复原原启动命令与环境）

## License

MIT © forfeeling
