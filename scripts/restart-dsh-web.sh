#!/usr/bin/env bash
# 重启 dsh web（用于加载新装/更新的插件，如 dsh-vault）。
# ⚠️ 在云服务器自己的终端执行（SSH 或云厂商网页终端），登录用户须与 dsh web 进程一致（本机为 ubuntu）。
#    不要用 root 执行（会以 root 身份重启服务）；若已用 root 登录，先: su - ubuntu
# 安全顺序：先锁定真进程、验证 node 与原参数可用，之后才允许 kill。
# 用法: bash scripts/restart-dsh-web.sh   [LOG=/path/to/log]
set -euo pipefail

# 1) 定位真正的 dsh web 进程（按 /proc/<pid>/exe 指向 node 过滤，排除恰好含关键字的 shell）
PID=""
for p in $(pgrep -f 'dsh web --host' || true); do
  exe=$(readlink -f "/proc/$p/exe" 2>/dev/null || true)
  case "$exe" in *node*) PID="$p"; break;; esac
done
if [ -z "$PID" ]; then
  echo "未找到 dsh web 进程（或无权读取 /proc/<pid>/exe——请用运行 dsh 的同一用户执行，如 ubuntu）"
  exit 1
fi

# 2) 抓取原命令行 / node 绝对路径 / 工作目录 / 关键环境
mapfile -d '' CMD < "/proc/$PID/cmdline"
NODE_BIN=$(readlink -f "/proc/$PID/exe" 2>/dev/null || true)
{ [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; } || NODE_BIN=$(command -v node || true)
if [ -z "${NODE_BIN:-}" ] || [ ! -x "$NODE_BIN" ]; then
  echo "❌ 找不到可用的 node，拒绝杀掉旧进程（请检查权限/用户）"; exit 1
fi
CWD=$(readlink "/proc/$PID/cwd" 2>/dev/null || true)
{ [ -n "$CWD" ] && [ -d "$CWD" ]; } || CWD="$HOME"
while IFS= read -r -d '' kv; do
  case "$kv" in DSH_*|PATH=*|HOME=*|NODE_OPTIONS=*) export "$kv";; esac
done < "/proc/$PID/environ" 2>/dev/null || true
export PATH="$(dirname "$NODE_BIN"):$PATH"

# 从原参数中提取 --port（默认 3080）
PORT=3080; prev=""
for a in ${CMD[@]:1+"${CMD[@]:1}"}; do
  if [ "$prev" = "--port" ]; then PORT="$a"; fi
  prev="$a"
done

# 3) 全部验证通过后才杀旧进程
LOG="${LOG:-/tmp/dsh-web.log}"
echo "==> PID=$PID  node=$NODE_BIN  cwd=$CWD  port=$PORT"
echo "==> 原参数: ${CMD[*]:1}"
echo "==> 停止旧进程…"
kill "$PID"
for _ in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$PID" 2>/dev/null; then echo "    优雅退出超时 → kill -9"; kill -9 "$PID" 2>/dev/null || true; sleep 1; fi

# 4) 原样重启（node 绝对路径 + 原参数；nohup 脱离终端）
echo "==> 重启中（日志: $LOG）…"
cd "$CWD"
nohup "$NODE_BIN" ${CMD[@]:1+"${CMD[@]:1}"} >>"$LOG" 2>&1 &
disown 2>/dev/null || true

# 5) 健康检查（最长约 15 秒）
sleep 3
NEW=""
for p in $(pgrep -f 'dsh web --host' || true); do
  exe=$(readlink -f "/proc/$p/exe" 2>/dev/null || true)
  case "$exe" in *node*) NEW="$p"; break;; esac
done
if [ -n "$NEW" ] && [ "$NEW" != "$PID" ]; then
  echo "==> 新进程 PID=$NEW"
  ok=0
  for _ in $(seq 1 10); do
    if curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/"; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" = 1 ]; then
    echo "✅ GUI 已恢复: http://127.0.0.1:$PORT"
    echo "   浏览器刷新页面 → 设置 → 插件 → 🔐 密钥库"
  else
    echo "⚠️ 进程已起但 HTTP 未就绪，请查看日志: tail -f $LOG"
  fi
else
  echo "❌ 未检测到新进程，查看日志: tail -n 50 $LOG"
  exit 1
fi
