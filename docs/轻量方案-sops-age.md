# 轻量方案落地记录：sops + age 密钥库（层级 1）

> 状态：**v0.2 已安装、13 步全链路验收通过**（2026-11-04）。
> 这是 [设计文档](设计文档.md) 的轻量前置层：完整 dsh-vault 插件若启动，其存储内核与
> 密保/审计机制可直接复用本方案；简单场景则到此为止（YAGNI）。

---

## 1. 已安装组件

| 组件 | 位置 | 说明 |
|---|---|---|
| `sops` v3.13.3 | `~/.local/bin/sops` | 静态二进制（GitHub release 经镜像下载，大小与 API 精确核对） |
| `age` / `age-keygen` v1.1.1 | `~/.local/bin/` | Ubuntu noble 官方源 .deb 解包（免 root） |
| `secretctl` **v0.2** | `~/.local/bin/secretctl` | 统一管理入口（源码 `bin/secretctl`） |
| `secret-store` skill v0.2 | `~/.dsh/skills/secret-store/SKILL.md` | agent 铁律 + 密保编排流程（技能目录已生效） |
| age 主密钥 | `~/.config/sops/age/keys.txt` (0600) | **全库唯一解密凭据：`secretctl backup-key` 立即离线备份** |
| 密文库 | `~/.config/secret-store/secrets.enc.yaml` (0600) | 仅秘密值为 ENC[...] 密文 + 哨兵键 |
| 元数据边车 | `~/.config/secret-store/metadata.tsv` (0600) | 明文 TSV：KEY/系统/账号/到期/录入/来源/备注 |
| 密保库 | `~/.config/secret-store/challenge.json` (0600) | scrypt(n=16384) 哈希答案 + 失败计数 + 锁定截止 |
| 审计日志 | `~/.config/secret-store/audit.log` (0600) | append-only，TSV，无秘密值 |

全部位于会话工作区之外——DSH 沙箱（workspace-write）阻止其他会话的 bash 触达。

## 2. v0.2 能力（对应设计文档 M1 的 CLI 落地）

| 能力 | 命令 | 设计要点 |
|---|---|---|
| **本地生成** | `secretctl gen KEY --system S [--len 24]` | CSPRNG 生成→直接加密入库；任何出口只见脱敏值（`D0g****jvCs`），明文从不经过聊天/终端回显/日志 |
| **密保挑战** | `protect init/questions/status/off` + `challenge [--stdin]` | 答案 scrypt 加盐哈希；通过→300s 宽限窗口（`.challenge-pass` 时间戳）；5 次失败→锁定 30 分钟；`get/use/peek` 受门槛，`add/gen/rm/list/expiry` 不受（登记与盘点不需要） |
| **审计日志** | `secretctl audit [N]` | init/add/gen/get/use/peek/rm/challenge(pass·fail·locked)/protect/expiry 全留痕：时间/动作/KEY/结果/来源；`use` 记录命令文本（只含变量引用） |
| **脱敏出口** | `secretctl peek KEY` | 前3后4（短值只报长度），核对身份不暴露全文 |
| **到期巡检** | `secretctl expiry [DAYS]` | 只读元数据边车（不解密），报告"剩余 N 天/已过期 N 天" |

agent 侧编排（SKILL.md 已固化）：调取被门槛拒绝时 → `protect questions` 取题面 →
`ask_user_question` 问用户 → 答案管道进 `challenge --stdin` → 宽限窗口内重试原操作。
铁律新增：**禁止绕过门槛**（不得改用 `sops -d` 直读）、**禁止试错答案**（锁定风险）。

## 3. 设计与踩坑记录（v0.1 → v0.2 累计）

1. **sops 会加密 YAML 注释**（`type:comment`）→ "注释存元数据"不成立，改明文 TSV 边车；盘点全程不解密。
2. **sops 配置发现按 CWD**（v3.13 从工作目录向上找 `.sops.yaml`，非文件所在目录）→ 一律显式 `--age <公钥>`。
3. **空 YAML 文档无法加密**（EOF）→ 常驻哨兵键 `_STORE_VERSION`，删空后库仍可用。
4. **`$(mktmp)` 子 shell 丢登记** → `newtmp` 置全局 `_TMP`；EXIT trap `shred -u` 全部明文临时文件；trap 以 `return 0` 收尾（空数组 + `set -e` 曾把整个命令打成退出码 1）。
5. **`python3 - <<'EOF'` 吃掉 stdin**：程序本身经 stdin 传入后 `sys.stdin` 即枯竭，管道输入的 Q/A 永远读不到 → 程序改存变量走 `python3 -c "$_PY_PROG"`。
6. **`IFS=$'\t' read` 合并连续 tab**（tab 属 IFS 空白符），空账号列导致 expiry 串列读错 → 日期解析改 gawk `mktime` 单遍扫描（`awk -F'\t'` 不合并空字段）。
7. **值永不走 argv**：录入仅 `--stdin` / `--from-file`（读后 shred）/ tty 交互；审批卡与进程列表只见 KEY 名与元数据。

## 4. 验收证据（`scripts/test-secretctl.sh` 13 步，2026-11-04 全过）

| 步 | 项 | 结果 |
|---|---|---|
| 1 | init 幂等建库 | ✅ |
| 2 | gen 生成 20 位入库 | ✅ 回显仅 `D0g****jvCs`；get 验证长度=20 |
| 3 | add×3（含临期/过期） | ✅ 回执仅元数据 |
| 4 | list 不解密盘点 | ✅ 四条目表格正确 |
| 5 | expiry 30 | ✅ NEAR_KEY 剩余 9 天、OLD_KEY 已过期 3 天 |
| 6 | use 注入 | ✅ stdout 仅长度（25/20），值不出现 |
| 7 | protect init --stdin | ✅ 2 题入库，status=MISSING |
| 8 | 门槛 | ✅ 未验证时 get/use/peek 全部被拒 |
| 9 | 错答→锁定→超时 | ✅ FAIL:1 → LOCKED:3 → 锁定中正确答案也拒 → 4s 后 PASS |
| 10 | 通过后恢复 | ✅ 往返逐字节一致；peek 掩码格式正确 |
| 11 | 宽限过期（TTL=2s） | ✅ 窗口内 get 成功，3s 后被拒，重验后恢复 |
| 12 | 覆盖写+全删+审计 | ✅ 26 条审计含 fail/locked/pass 全事件 |
| 13 | 残留检查 | ✅ 目录仅 4 个预期文件，无 .tmp 明文残留 |

⚠️ 该脚本会**清空重建**密钥库，仅供验收，勿在存有真实密钥时运行。

## 5. 与完整 dsh-vault（M2/M3）的关系

- 本方案已覆盖 M1 的**功能内核**（存储/生成/密保/审计/脱敏/到期），以 CLI+skill 形态交付。
- 尚未做（对应后续里程碑）：GUI 解锁对话框与浏览页（见 [GUI表单实现方案](GUI表单实现方案.md)，
  主密码级因子目前缺位——现防护 = 文件权限 + 私钥文件 + 密保门槛）、云同步自动化（现为手动
  复制/git）、cordis host 插件工具面（现为 bash+skill）、到期主动推送（现为 `expiry` 命令）、
  剪贴板出口（无桌面环境，未做）。
- 升级路径：host 插件直接包装 `secretctl` 即可继承全部机制；challenge.json/audit.log 格式不变。

## 6. 立即要做的两件事（用户侧）

1. **备份主密钥**：自己终端运行 `secretctl backup-key`，手抄/复制 `keys.txt` 异地保存
   （丢了它 = 全库永久不可解；我不代为读取或展示其内容）。
2. **启用密保**（建议）：自己终端运行 `secretctl protect init`（tty 交互设置 Q/A，
   答案不经过对话），之后 agent 调取密钥必须经你在场作答。
3. 真实密钥逐条登记：高价值密钥在自己终端 `secretctl add KEY --system ...`（tty 输入），
   一般密钥可直接在对话里让我登记。
