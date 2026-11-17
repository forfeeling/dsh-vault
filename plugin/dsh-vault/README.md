# dsh-vault

DeepSeek Harness 插件：`secretctl`（sops+age 加密密钥库）的 GUI 管理页。

## 功能

- **条目**：元数据浏览（KEY/系统/账号/到期/录入/来源/备注），临期/过期角标，脱敏核对（前3后4），删除（二次确认）
- **登记**：表单登记已有值（秘密值 `type=password` 只上行、提交即擦）或**本地生成**（CSPRNG 直接入库，明文全程不出现）
- **密保**：显示密保问题、页内作答解锁（通过后进入宽限窗口，CLI/agent 同步放行）；锁定与失败计数由 secretctl 状态机执行
- **审计**：最近 50 条操作日志（append-only，无秘密值）

## 架构与安全边界

- 通道：host 侧 `webServer.register` 同源路由 `POST /vault`（无 CORS、无额外端口），client 侧 `fetch("./vault")`
- **零知识**：明文永不回流浏览器；响应只含元数据/脱敏值/状态
- `add/gen/rm/challenge/peek` 仅限回环来源；LAN 直连浏览器只读元数据
- 秘密值只经子进程 **stdin** 传给 `secretctl`，绝不进 argv/日志
- 所有校验、门槛、审计仍由 `secretctl` 单点执行——GUI 与 CLI/agent 共用同一套状态

## 依赖（运行环境）

- `secretctl` v0.2+ 在 `~/.local/bin`（sops、age、python3 可用）
- 密钥库已 `secretctl init`

## 安装（profile 方式）

```bash
cp -r plugin/dsh-vault ~/.dsh/profiles/web/node_modules/@forfeeling/dsh-vault
# ~/.dsh/profiles/web/package.json:
#   dependencies 加  "@forfeeling/dsh-vault": "file:node_modules/@forfeeling/dsh-vault"
#   dsh.profile.bundles 数组加 "@forfeeling/dsh-vault"
# 然后重启 dsh web
```

GUI 入口：设置 → 插件 → 🔐 密钥库。
