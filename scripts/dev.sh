#!/usr/bin/env bash
# scripts/dev.sh —— 一条命令本地起 MVP 全栈开发环境
#
# 行为：
#   1. 校验 .env 存在（不存在则提示用户先 cp .env.example .env 并填凭据）
#   2. 后台启动后端 uvicorn（默认 http://127.0.0.1:8000）
#   3. 前台启动前端 vite dev server（默认 http://localhost:5173）
#   4. 前台进程 Ctrl+C 时 trap 自动杀掉后端
#
# 用法：
#   bash scripts/dev.sh
# 或者
#   ./scripts/dev.sh
#
# 仅适用于 macOS / Linux。

set -euo pipefail

# 锚定项目根（scripts/ 的上一层）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# ---- 前置校验：.env ----
if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cat >&2 <<'EOF'
[dev.sh] 缺少 .env 文件。

请先复制模板并填入凭据：
  cp .env.example .env
  # 然后编辑 .env，把 5 个变量（MODELVERSE_API_KEY / UFILE_PUBLIC_KEY /
  # UFILE_PRIVATE_KEY / UFILE_BUCKET / UFILE_REGION）替换成真实值。

填完后再执行 ./scripts/dev.sh。
EOF
  exit 1
fi

# ---- 前置校验：后端依赖目录可达 ----
if [[ ! -d "$ROOT_DIR/backend/app" ]]; then
  echo "[dev.sh] 没找到 backend/app/，请确认在仓库根目录运行本脚本。" >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/frontend" ]]; then
  echo "[dev.sh] 没找到 frontend/，请确认在仓库根目录运行本脚本。" >&2
  exit 1
fi

# ---- 后端：后台启动 ----
BACKEND_LOG="$ROOT_DIR/.dev-backend.log"
echo "[dev.sh] 启动后端 (uvicorn app.main:app --reload)，日志：$BACKEND_LOG"

(
  cd "$ROOT_DIR/backend"
  # 用 nohup 后台跑；stdout/stderr 全部重定向到日志
  nohup uvicorn app.main:app --reload >"$BACKEND_LOG" 2>&1 &
  echo $! > "$ROOT_DIR/.dev-backend.pid"
)

BACKEND_PID="$(cat "$ROOT_DIR/.dev-backend.pid")"
echo "[dev.sh] 后端 PID = $BACKEND_PID"
echo "[dev.sh] 若需手动停止后端：kill $BACKEND_PID"

# ---- trap：前端退出时一并清理后端 ----
cleanup() {
  echo ""
  echo "[dev.sh] 捕获退出信号，停止后端 PID=$BACKEND_PID ..."
  if kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    # 给 uvicorn 一点时间优雅退出
    sleep 1
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
      kill -9 "$BACKEND_PID" 2>/dev/null || true
    fi
  fi
  rm -f "$ROOT_DIR/.dev-backend.pid"
  echo "[dev.sh] 后端已停止。"
}
trap cleanup EXIT INT TERM

# 等一下，让 uvicorn 起来后能看到 healthz
sleep 2
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "[dev.sh] 后端进程未存活，查看日志：$BACKEND_LOG" >&2
  exit 1
fi

# ---- 前端：前台启动 ----
# 注意：这里不能用 exec —— exec 会用 npm 进程替换当前 bash，导致上面注册的
# trap cleanup EXIT INT TERM 全部失效（Ctrl+C 不清理后端 / 前端崩溃后端成孤儿）。
# 让 bash 继续存活，npm 退出后才能走到 EXIT trap 执行 cleanup。
echo "[dev.sh] 启动前端 (vite)..."
cd "$ROOT_DIR/frontend"
npm run dev
