# 网页版 AI 视频生成平台 MVP

单用户本机自用的网页 AI 视频生成工具。用户在浏览器中输入 prompt（可选附一张首帧参考图），提交后由后端生成视频，成功后在时间倒序的历史菜单中可反复播放、下载、重命名、删除。

仅作为网页在桌面浏览器中使用，不打包为桌面/移动客户端，不做多用户、不做云同步、不做分享。

## 项目目标

- 用最短链路把 UCloud 星图 ModelVerse 的 `kling-v3` 视频生成能力接起来。
- 前端单页应用 + 后端 FastAPI 薄代理两份代码，单机运行。
- 历史仅存本浏览器（IndexedDB 索引 + UFile 对象存储视频本体）。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端构建 | Vite |
| 前端框架 | React 18 + TypeScript |
| 前端持久化 | 浏览器 IndexedDB（仅存历史索引） |
| 后端语言 | Python 3.11+ |
| 后端框架 | FastAPI |
| 后端任务 | FastAPI BackgroundTasks + asyncio |
| 后端持久化 | SQLite（单文件 `tasks.db`） |
| 后端 HTTP 客户端 | httpx（异步） |
| 对象存储 SDK | UCloud 官方 `ufile` Python SDK |
| 视频模型 | UCloud 星图 ModelVerse `kling-v3` |
| 对象存储 | UCloud UFile（US3） |

## 目录结构

```
.
├── backend/            # Python FastAPI 后端（详见 backend/README.md）
├── frontend/           # React + Vite 前端（详见 frontend/README.md）
├── scripts/
│   └── dev.sh          # 一条命令同时起后端（后台）+ 前端（前台）
├── .env.example        # 环境变量模板
├── .gitignore
└── README.md
```

## 所需环境变量

后端启动前需要把以下变量写入 `.env`（可复制 `.env.example` 改名）：

| 变量名 | 说明 |
|---|---|
| `MODELVERSE_API_KEY` | UCloud 星图 ModelVerse 的 API Key，用于调用 kling-v3 视频生成接口 |
| `UFILE_PUBLIC_KEY` | UCloud UFile 公钥 |
| `UFILE_PRIVATE_KEY` | UCloud UFile 私钥 |
| `UFILE_BUCKET` | UFile 存储空间名（需在 UCloud 控制台手动创建） |
| `UFILE_REGION` | UFile bucket 所在 region（如 `cn-bj`） |

凭据仅保留在后端环境，前端代码不得出现。

## 启动方式

### 前置依赖

- macOS / Linux
- Python 3.11+
- Node.js 18+（含 npm）
- 一份可用的 UCloud 账号，已在控制台创建好 UFile bucket，并拿到 ModelVerse API Key

### 第一步：准备 `.env`

复制模板并填入凭据：

```bash
cp .env.example .env
# 编辑 .env，把 5 个变量替换成真实值：
#   MODELVERSE_API_KEY / UFILE_PUBLIC_KEY / UFILE_PRIVATE_KEY
#   UFILE_BUCKET / UFILE_REGION
```

`.env` 已在 `.gitignore` 中，不会被提交。后端启动时会校验所有必填项，缺哪个就立即抛 `RuntimeError` 并提示。

### 第二步（可选，推荐首次执行）：手动起后端

> 项目用 `pyproject.toml` 管依赖，**不是 `requirements.txt`**——所以下方安装命令是 `pip install -e`，启动命令不变。

```bash
# 在项目根目录建虚拟环境（建议）
python -m venv .venv
source .venv/bin/activate

# 安装后端（可编辑模式 + dev extras，含 pytest）
pip install -e "backend[dev]"

# 启动后端
cd backend
uvicorn app.main:app --reload
# 默认监听 http://127.0.0.1:8000
```

健康检查：

```bash
curl http://127.0.0.1:8000/healthz
# {"status":"ok"}
```

### 第三步：手动起前端

```bash
cd frontend
npm install
npm run dev
# 默认监听 http://localhost:5173
```

浏览器打开 `http://localhost:5173`，应能看到双栏布局（左侧历史菜单 / 右侧输入区）。Vite 已配 `/api` 代理到后端 `http://localhost:8000`，前端无需关心后端端口。

### 一条命令同时起前后端（推荐日常开发）

```bash
./scripts/dev.sh
```

- 校验 `.env` 是否存在（缺失会给出复制 `.env.example` 的指引并退出）
- 后台跑 `uvicorn app.main:app --reload`，日志写入 `.dev-backend.log`，pid 写入 `.dev-backend.pid`
- 前台跑 `npm run dev`
- 前台 Ctrl+C 退出时 trap 会自动杀掉后端进程
- 若手动停止：`kill $(cat .dev-backend.pid)`

仅适用于 macOS / Linux。Windows 用户请按第二、三步分别在两个终端中起。

## 联调验证清单

下面是 MVP 端到端联调时必须手动跑通的检查项。每一条都给出操作步骤与预期结果；任一条不通过即不算完成。建议在 `./scripts/dev.sh` 启动并保持运行的前提下逐条验证。

### A. 健康与加载

1. **后端健康**
   ```bash
   curl http://127.0.0.1:8000/healthz
   ```
   预期：HTTP 200，body `{"status":"ok"}`。

2. **前端加载**
   浏览器打开 `http://localhost:5173`。
   预期：双栏布局可见，左侧为历史抽屉（首次启动为空），右侧为 prompt 输入区与「生成视频」按钮，无控制台报错。

### B. 文生视频成功路径

3. **提交 text-only 任务**
   在右侧 textarea 输入任意 prompt（如 `A cinematic shot of a futuristic city at dusk`），不上传图片，点击「生成视频」。
   预期：
   - 输入区与按钮变 disabled；
   - UI 切换到「生成中」面板，显示状态从 `pending` 过渡到 `running`（5 秒轮询节奏）；
   - 大约 1～5 分钟后状态变为 `success`，主区域出现内嵌 `<video controls>` 能播放新视频。

4. **历史菜单新增**
   预期：步骤 3 成功后，左侧历史菜单顶部立刻出现一条新记录，标题默认是 prompt 截断，时间为「刚刚」。

### C. 并发冲突 409

5. **生成中再次提交**
   在步骤 3 任务进入 `running` 但尚未 `success` 的窗口内（建议先提交一个慢 prompt 留时间）：
   - 用另一个浏览器标签页打开同一地址；或者
   - 直接 `curl -X POST http://localhost:8000/api/tasks -H 'Content-Type: application/json' -d '{"prompt":"second","image":null}'`

   预期：HTTP 409，body 形如
   ```json
   {"error": "task_in_progress", "current_task_id": "<前一个 in-flight id>"}
   ```
   前端 UI 给出明确提示（带 in-flight id），不静默吞错。

### D. 历史排序

6. **finished_at 倒序**
   再提交至少一条 text-only 任务（等步骤 3 完全结束后），等其成功。
   预期：左侧历史菜单中**最新成功的在最上方**；调 `curl http://localhost:8000/api/tasks` 看返回数组也是 `finished_at` 倒序。

### E. 图生视频路径

7. **上传首帧图**
   在输入区上传一张 jpg/jpeg/png（≤ 10MB），缩略图出现；点「移除」可移除，再选新图。

8. **提交 + 历史详情看图**
   输入 prompt（如 `make this image come alive with gentle motion`），点击「生成视频」。
   预期：
   - 成功后历史菜单新增一条；
   - 点击该历史项，主区域切换到「历史详情」，能看到：
     - prompt 全文
     - 内嵌 `<video controls>` 能播放
     - 当初上传的首帧图原图（前端从 IndexedDB 的 `imageBase64` + `imageMimeType` 还原 `data:` URL）

### F. 重命名 / 删除

9. **重命名**
   在历史详情中重命名任一记录为「我的城市夜景」并保存。
   预期：左侧菜单该项标题立刻变为新值；刷新页面后仍是新值（IndexedDB 缓存了 + 后端持久化了）。

10. **删除**
    在历史详情中点删除，二次确认后执行。
    预期：左侧菜单该项消失；调 `curl http://localhost:8000/api/tasks/<id>` 返回 404；再次播放该视频的 URL 也不再可用（UFile 对象已删）。

### G. 持久化

11. **刷新浏览器**
    在已有若干历史的情况下按 F5。
    预期：历史菜单中所有条目（含视频、prompt、首帧图、自定义标题）仍可见且能正常播放。

12. **关闭并重开浏览器**
    完全关闭浏览器进程，重新打开 `http://localhost:5173`。
    预期：历史菜单仍完整可见，能继续播放、下载、重命名、删除。

## 已知开放问题

以下问题在 MVP 执行阶段未做硬性结论，留待真实联调中观察 / 试错。如果你接手联调，遇到对应症状请优先排查或调整以下假设：

- **UFile 预签名 URL 最大过期上限未确认**。当前 `get_play_url` 默认签发 1 小时（3600 秒）。如果 US3 实际不允许这么长，需在 `backend/app/services/ufile.py` 把 `expires_seconds` 降到允许的最大值。症状：返回的 URL 直接 403 / SignatureExpired。
- **UFile cn-bj region HTTPS 是否完全可用未实测**。默认按 `open_ssl=True` 签 HTTPS URL；若浏览器拉视频偶发 SSL 错误或拒绝 mixed content，需要换 region 或临时降级 HTTP。
- **ModelVerse `kling-v3` 视频任务实际 P95 耗时未观测**。当前用 5 分钟硬超时。若实测多数任务 < 1 分钟，可在 `orchestrator.py` 把硬超时调短改善失败感知；若 P95 > 5 分钟则需延长，否则成功率会被超时吞掉。
- **ModelVerse 单账号视频任务的 QPS / 并发上限未在文档中明示**。本设计已强约束并发 = 1（进程内 `asyncio.Lock`），理论上不会撞限流；如联调出现 429，需要在客户端层加退避策略。
- **`<video>` 在 UFile 私有 URL 上的 seek / 下载行为依赖 bucket CORS**。详见 [`backend/CORS.md`](./backend/CORS.md)。如果首次联调时 seek 卡死或下载不触发，**先检查 bucket CORS 是否配齐**（GET/HEAD + Range，暴露 `Content-Length` / `Content-Range` / `Accept-Ranges`），这是最常见的故障源。
- **后端启动时对历史 `running` 行的处理策略**。当前实现把所有遗留 pending/running 一律标记为 `failure`（error_message=`interrupted_by_restart`）。如运营上希望能恢复正在跑的任务（断点续轮询），需要改造 `mark_orphans_failed`——MVP 不做。
- **前端 IndexedDB 与后端历史 diff 的策略**。当前以后端 `GET /api/tasks` 为权威源（PLAN 阶段对 DESIGN 的修正），本地 IndexedDB 仅缓存 + 持有首帧图 base64。多浏览器 / 跨设备场景下首帧图会缺失（其它浏览器没存过这张图），属于 MVP 已知限制。

## 相关文档

- 需求：`.cadence/cycle-video-gen-mvp/REQUIREMENT.md`
- 技术设计：`.cadence/cycle-video-gen-mvp/DESIGN.md`
