---
name: secret-store
description: "加密密钥库（sops+age）：登记、生成、检索、密保挑战、注入使用密码/API key/token，含审计日志与到期巡检。当用户要求记住/保存/生成密码、API key、token、私钥，或任务需要引用已登记密钥，或询问存了哪些密钥/何时到期/谁动过密钥时使用。铁律：明文永不回显、永不写入报告与代码，使用一律走环境变量注入。"
metadata:
  slug: "secret-store"
  displayName: "密钥库"
  version: "0.2.0"
  summary: "sops+age 加密密钥的登记、生成、密保调取与安全使用"
---

# 密钥库（secretctl v0.2）

本机密钥库（`~/.config/secret-store/`，全部 0600）：
- `secrets.enc.yaml` —— 仅秘密值，sops+age 加密；
- `metadata.tsv` —— 明文元数据边车（KEY/系统/账号/到期/录入时间/来源/备注），盘点不需解密；
- `challenge.json` —— 密保问题（scrypt 哈希，可选启用）；
- `audit.log` —— append-only 审计日志（无秘密值）。

主密钥：`~/.config/sops/age/keys.txt`（0600）。管理命令：`secretctl`（在 PATH）。

## 铁律（任何情况下不得违反）

1. **禁止回显明文**：不得运行 `secretctl get` / `sops -d` 并把输出展示给用户，除非用户**明确要求看到完整值**且你已提示"明文将出现在对话与会话日志中"。核对身份一律用 `secretctl peek KEY`（前3后4脱敏）。
2. **使用一律注入**：任务需要密钥时，用 `secretctl use -- '<命令>'`，命令里只写 `$KEY_NAME` 变量引用。禁止把密钥值写进命令行字面量、代码文件、报告、提交信息。
3. **登记不留痕**：回执只说 KEY 名与元数据（系统/到期/录入时间）或脱敏值，绝不复述明文。
4. **密保门槛不可绕过**：`get/use/peek` 被"需先通过密保验证"拒绝时，走下面的编排流程；禁止改用 `sops -d`、直接读库文件等方式绕过。
5. **不许试错密保答案**：答案只能来自用户本人；连续失败会触发 30 分钟锁定，锁定期间不要重试，如实告知用户。
6. 发现用户消息里有疑似密钥：先问是否登记；登记后提醒原消息仍留在会话日志/IM 平台，建议删除或轮换。

## 登记

**新密钥优先本地生成（明文从不出现在任何通道，最安全）：**

```bash
secretctl gen GITHUB_TOKEN --system GitHub --len 24 --expires 2027-06-30
# 回执含脱敏值；需要交给目标系统时: secretctl use -- 'pbcopy...' 不适用（无桌面），
# 人工取值: 提示用户在自己终端运行 secretctl get GITHUB_TOKEN
```

**存量密钥登记：**

```bash
printf '%s' '<值>' | secretctl add GITHUB_TOKEN \
  --system GitHub --account user@example.com \
  --expires 2026-12-31 --source chat --note "ci 用" --stdin
```

- KEY 名用环境变量风格（大写+下划线）。`--system` 必填；有效期已知填 `--expires YYYY-MM-DD`。
- 多行值（私钥/证书）：先 `base64 -w0` 单行化，note 注明编码。
- **高价值密钥**（主账号密码、支付类、云主账号 AK）：建议用户在自己终端运行 `secretctl add KEY --system ...`（tty 交互，明文完全不经过对话），你只提供命令文本。
- 用户粘贴密钥但没说要保存：先问，不擅自入库。

## 检索与盘点（不解密）

```bash
secretctl list            # 全部条目元数据——用户问"存了哪些"用这个
secretctl expiry 30       # 30 天内到期/已过期条目——用户问"快过期的"用这个
secretctl audit 20        # 最近 20 条操作审计——用户问"谁动过/什么时候用的"用这个
secretctl peek KEY        # 脱敏核对（需密保通过）
```

## 使用（任务需要密钥时）

```bash
secretctl use -- 'curl -sf -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user'
secretctl use -- 'python3 deploy.py'    # 脚本内经 os.environ 读取
```

- 子进程退出即消失；执行前检查命令不会把密钥打印到 stdout（如 debug 输出）。
- 后台 job 同样用 `secretctl use -- '...'` 包裹启动命令。

## 密保挑战编排（get/use/peek 被门槛拒绝时）

```
① secretctl protect questions          # 取题面（题面不是秘密）
② 用 ask_user_question 工具把题目原样问用户（自由文本作答，一题一问）
③ printf '%s\n' '<答1>' '<答2>' | secretctl challenge --stdin
④ 通过后 300 秒宽限窗口内重试原操作（use/get/peek）
```

- 设计定位：密保答案是"在场证明门槛"，经对话传输属预期暴露级；**高安全要求时**改为请用户在自己终端运行 `secretctl challenge`，你在宽限窗口内直接执行后续操作。
- `FAIL:n` → 告知剩余尝试次数，请用户确认答案；`LOCKED:n` → 告知锁定剩余秒数，停止尝试。
- 用户问密保状态：`secretctl protect status`。

## 删除与修改

```bash
secretctl rm KEY          # 删除（含元数据；不可恢复）
secretctl add KEY ...     # 同名 KEY 再次 add/gen 即覆盖（旧值不留历史）
```

## 初始化与备份（新机器 / 用户询问恢复）

```bash
secretctl init                          # 建库（幂等）
secretctl backup-key                    # 主密钥离线备份指引
secretctl protect init                  # 设置密保（tty 交互；agent 环境用 --stdin 需用户先在终端完成更妥）
```

主密钥丢失 = 全库不可解，初始化后必须提醒用户备份 `keys.txt`。
库目录（密文+元数据+审计）可整体复制到私有 git 仓库/网盘同步（云端不见明文）。

## 故障排查

- `sops: command not found` → 二进制在 `~/.local/bin`，确认 PATH。
- 解密失败 `no matching key` → 主密钥被移动/替换，检查 `~/.config/sops/age/keys.txt`。
- `需先通过密保验证（状态:EXPIRED）` → 宽限窗口已过，重新编排 challenge。
- 库文件损坏 → 从 git 同步历史恢复；secretctl 写入均为原子替换。
