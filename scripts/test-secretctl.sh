#!/usr/bin/env bash
# ⚠️ 验收脚本：会清空并重建 ~/.config/secret-store（仅用于测试，含假演示值）
set -e
W="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

cp "$W/bin/secretctl" ~/.local/bin/secretctl && chmod 755 ~/.local/bin/secretctl
cp "$W/skills/secret-store/SKILL.md" ~/.dsh/skills/secret-store/SKILL.md
rm -f ~/.config/secret-store/secrets.enc.yaml ~/.config/secret-store/metadata.tsv \
      ~/.config/secret-store/audit.log ~/.config/secret-store/challenge.json \
      ~/.config/secret-store/.challenge-pass ~/.config/secret-store/.tmp.* 2>/dev/null || true

echo "=== 1) init"
secretctl init

echo "=== 2) gen 本地生成（明文全程不显示）"
secretctl gen GEN_KEY --system 生成测试 --len 20
V=$(secretctl get GEN_KEY); [ ${#V} -eq 20 ] && echo GEN_LEN_OK; V=""

echo "=== 3) add 三条（stdin，含临期/过期各一）"
printf '%s' 'fake-demo-token-abc123XYZ' | secretctl add TEST_TOKEN --system "测试系统" --expires 2027-01-01 --source chat --stdin
SOON=$(date -d '+10 days' +%F); PAST=$(date -d '-3 days' +%F)
printf '%s' 'near-key' | secretctl add NEAR_KEY --system "临期系统" --expires "$SOON" --stdin
printf '%s' 'old-key'  | secretctl add OLD_KEY  --system "过期系统" --expires "$PAST"  --stdin

echo "=== 4) list（不解密盘点）"
secretctl list

echo "=== 5) expiry（应报告 NEAR_KEY 剩余~9天、OLD_KEY 已过期~4天）"
secretctl expiry 30

echo "=== 6) use 注入（只显示长度）"
secretctl use -- 'echo TEST_TOKEN_len=${#TEST_TOKEN} GEN_KEY_len=${#GEN_KEY}'

echo "=== 7) 启用密保（假 Q/A）"
printf '%s\n' '测试问题一' '答案1' '测试问题二' '答案2' | secretctl protect init --stdin
secretctl protect status

echo "=== 8) 门槛：未通过密保时 get/use/peek 应被拒"
if secretctl get GEN_KEY >/dev/null 2>&1; then echo GATE_FAIL_GET; exit 1; else echo GATE_GET_OK; fi
if secretctl use -- 'true' >/dev/null 2>&1; then echo GATE_FAIL_USE; exit 1; else echo GATE_USE_OK; fi
if secretctl peek GEN_KEY >/dev/null 2>&1; then echo GATE_FAIL_PEEK; exit 1; else echo GATE_PEEK_OK; fi

echo "=== 9) 错答→锁定→超时解锁（加速：2 次锁、锁 3 秒）"
export SECRETCTL_MAX_FAILS=2 SECRETCTL_LOCK_SECS=3
printf '%s\n' '错1' '错2' | secretctl challenge --stdin 2>&1 | tail -1 || true
printf '%s\n' '错1' '错3' | secretctl challenge --stdin 2>&1 | tail -1 || true
printf '%s\n' '答案1' '答案2' | secretctl challenge --stdin 2>&1 | tail -1 || true   # 锁定中，正确答案也拒绝
sleep 4
unset SECRETCTL_MAX_FAILS SECRETCTL_LOCK_SECS
printf '%s\n' '答案1' '答案2' | secretctl challenge --stdin

echo "=== 10) 通过后恢复：往返一致 + 脱敏格式"
[ "$(secretctl get TEST_TOKEN)" = "fake-demo-token-abc123XYZ" ] && echo ROUNDTRIP_OK
secretctl peek TEST_TOKEN | grep -qE '^.{3}\*\*\*\*.{4}$' && echo PEEK_MASK_OK

echo "=== 11) 宽限窗口过期（TTL=2s）"
secretctl protect off
printf '%s\n' '测试问题一' '答案1' | SECRETCTL_PASS_TTL=2 secretctl protect init --stdin
printf '%s\n' '答案1' | secretctl challenge --stdin
secretctl get TEST_TOKEN >/dev/null && echo WITHIN_TTL_OK
sleep 3
if secretctl get TEST_TOKEN >/dev/null 2>&1; then echo TTL_FAIL; exit 1; else echo TTL_EXPIRED_OK; fi
secretctl protect off

echo "=== 12) 覆盖写 + 全删 + 审计"
printf '%s' 'v2-value' | secretctl add TEST_TOKEN --system "测试系统" --stdin
[ "$(secretctl get TEST_TOKEN)" = "v2-value" ] && echo OVERWRITE_OK
secretctl rm TEST_TOKEN; secretctl rm NEAR_KEY; secretctl rm OLD_KEY; secretctl rm GEN_KEY
secretctl audit 40

echo "=== 13) 残留检查（应只有 5 个预期文件）"
ls -la ~/.config/secret-store/
echo "ALL_TESTS_DONE"
