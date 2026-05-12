# 网页版 AI 视频生成 MVP 技术设计

把需求落成一个**前后端两份代码**的最小工程：

- 前端 SPA 在浏览器跑 UI、本地存历史索引、轮询任务状态。
- 后端 FastAPI 是一层薄代理，承担三件不能放前端的事：① 持有 ModelVerse API Key 与 UFile 公私钥；② 异步轮询 ModelVerse 视频任务（1～5 分钟）；③ 把成功视频从 ModelVerse 临时 URL 转存到 UCloud UFile，签发可播放的私有 URL 给前端。
- 视频生成路径走 UCloud 星图 ModelVerse 的 `kling-v3` 模型，文生 / 图生用同一接口、同一 model id，靠 `parameters.image` 是否传入自动切换。
- 视频本体存 UFile，前端历史只存 `task_id` + `object_key` + 元数据；播放/下载时按需向后端要预签名 URL（短有效期 1 小时）。
- 任务"单用户单任务串行"由后端进程内的 in-flight 锁强制执行，第二个并发提交直接 409。
- 前端历史用 IndexedDB 存索引（不存视频本体）；持久化键值对结构小，不依赖框架库。

## 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| 前端构建 | Vite | 最新稳定 |
| 前端框架 | React 18 + TypeScript | 函数组件 + hooks |
| 前端持久化 | 浏览器原生 IndexedDB（`idb` 库可选） | 仅存历史索引（task_id / object_key / prompt / 缩略元数据），不存 mp4 |
| HTTP 客户端 | 原生 `fetch` | 不引第三方 |
| 后端语言 | Python 3.11+ | |
| 后端框架 | FastAPI | 异步原生、Pydantic 校验 |
| 后端任务 | FastAPI `BackgroundTasks` + `asyncio` | 提交 API 立即返回，后台轮询 + 转存 |
| 后端持久化 | SQLite（`sqlite3` 标准库或 `aiosqlite`） | 单文件 `tasks.db`，存任务元数据；进程重启不丢 |
| HTTP 客户端（后端） | `httpx`（异步） | 调 ModelVerse |
| 对象存储 SDK | UCloud 官方 `ufile` Python SDK（`pip install ufile`） | 上传用 `putstream`、签发 URL 用 `private_url` |
| 视频模型 | UCloud 星图 ModelVerse `kling-v3` | base URL `https://api.modelverse.cn`；详细见 `research/ucloud-modelverse-kling.md` |
| 对象存储 | UCloud UFile（US3） | bucket 手动控制台创建，详细见 `research/ucloud-ufile-python.md` |

## 模块划分

### 前端（`frontend/`）

- `App.tsx`：根组件，组装输入区 + 进度态 + 历史抽屉 [新增]
- `components/PromptInput.tsx`：prompt 文本框 + 可选首帧图上传 + 提交按钮 [新增]
- `components/ProgressPanel.tsx`：当前任务进度（pending / running / 时长计时） [新增]
- `components/HistoryDrawer.tsx`：历史列表（成功任务），支持播放、下载、删除、重命名 [新增]
- `components/VideoPlayer.tsx`：内嵌 `<video>` 播放器，src 由后端按需签发 [新增]
- `lib/api.ts`：与后端交互的薄封装（POST `/api/tasks`、GET `/api/tasks/:id`、GET `/api/tasks/:id/play_url`） [新增]
- `lib/history.ts`：IndexedDB 读写（CRUD 历史索引） [新增]
- `lib/poller.ts`：单任务在前端的 5 秒轮询循环 [新增]

### 后端（`backend/`）

- `app/main.py`：FastAPI 入口，CORS 配置，路由挂载 [新增]
- `app/api/tasks.py`：路由：POST `/api/tasks`、GET `/api/tasks/{id}`、GET `/api/tasks/{id}/play_url`、GET `/api/tasks`（历史用） [新增]
- `app/services/modelverse.py`：ModelVerse 客户端（`submit_kling_task` / `query_kling_task`） [新增]
- `app/services/ufile.py`：UFile 封装（`upload_video_stream` / `get_play_url` / `delete_object`） [新增]
- `app/services/orchestrator.py`：单任务编排——后台 BackgroundTask 入口，负责轮询 ModelVerse + 成功后转存 UFile + 落库 [新增]
- `app/services/lock.py`：进程内单任务串行锁（`asyncio.Lock` 或简单标志） [新增]
- `app/storage/db.py`：SQLite 初始化 + tasks 表 CRUD [新增]
- `app/models.py`：Pydantic schema（请求/响应 DTO） [新增]
- `app/config.py`：环境变量读取（`MODELVERSE_API_KEY` / UFile 公私钥 / bucket / region / 默认 prompt 参数） [新增]

## 数据模型

### SQLite `tasks` 表（后端）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PRIMARY KEY | 后端生成的任务 ID（UUID） |
| `modelverse_task_id` | TEXT | ModelVerse 返回的 `task_id`，提交成功后回填 |
| `prompt` | TEXT | 用户输入的 prompt |
| `has_image` | INTEGER | 0 / 1，标记是文生还是图生 |
| `status` | TEXT | `pending` / `running` / `success` / `failure` |
| `error_message` | TEXT NULL | 失败时记录原因 |
| `ufile_object_key` | TEXT NULL | 成功后转存到 UFile 的对象 key（如 `videos/<id>.mp4`） |
| `title` | TEXT NULL | 用户重命名的标题；为空时前端按 prompt 截断展示 |
| `created_at` | INTEGER | unix 秒 |
| `finished_at` | INTEGER NULL | unix 秒 |

> `failure` 状态的行物理保留在表中是为了便于查日志，但**不通过历史接口返回给前端**；只有 `success` 行进入历史。

### IndexedDB `history` store（前端）

key：后端任务 `id`。value 结构：

```ts
{
  id: string,                  // 后端任务 id
  prompt: string,              // 提交时的 prompt
  hasImage: boolean,           // 是否图生
  title?: string,              // 用户自定义标题
  createdAt: number,           // unix ms
  finishedAt: number,          // unix ms
}
```

> 前端**不缓存视频字节**，每次播放/下载临时向后端要 `play_url`。这避免 IndexedDB 容易爆配额、也让"删除"动作只改后端 + 索引即可。
> 失败任务前端**不写入 IndexedDB**（与"失败不入历史"一致）。

## 接口设计

所有接口前缀 `/api`。请求体均为 JSON（图片用 base64 字符串）。

### POST `/api/tasks` — 提交生成任务

请求：
```json
{
  "prompt": "string, ≤ 2500",
  "image": "base64 string | null"   // 不带 data: 前缀，可选
}
```

响应：
- `200 OK`：`{ "id": "<uuid>", "status": "pending" }`
- `409 Conflict`：当前已有 in-flight 任务，body `{ "error": "task_in_progress", "current_task_id": "..." }`
- `400 Bad Request`：参数校验失败（prompt 空、图大小超 10MB、格式非 jpg/jpeg/png 等）

副作用：建一行 `tasks`（`status=pending`）→ 启 BackgroundTask 跑编排器 → 立即返回。

### GET `/api/tasks/{id}` — 查询单任务状态

响应：
```json
{
  "id": "...",
  "status": "pending | running | success | failure",
  "prompt": "...",
  "has_image": true,
  "title": null,
  "created_at": 1778517000,
  "finished_at": null,
  "error_message": null
}
```

`success` 时**不直接给视频 URL**，前端再走 `play_url` 接口。

### GET `/api/tasks/{id}/play_url` — 按需签发播放/下载 URL

响应：
```json
{ "url": "https://video-mvp.cn-bj.ufileos.com/videos/<id>.mp4?...&Expires=...&Signature=...", "expires_in": 3600 }
```

仅对 `status=success` 的任务有效；其它返回 404。

### GET `/api/tasks` — 历史列表（仅成功）

响应：
```json
[
  { "id": "...", "prompt": "...", "title": null, "has_image": false, "created_at": ..., "finished_at": ... }
]
```

按 `finished_at` 倒序。

### PATCH `/api/tasks/{id}` — 重命名标题

请求 `{ "title": "string" }`，响应 `200 OK { "id": "...", "title": "..." }`。

### DELETE `/api/tasks/{id}` — 删除历史

副作用：删 SQLite 行 + 删 UFile 对象。响应 `204 No Content`。

## 关键流程

### 提交一个文生视频任务

1. 前端校验 prompt 非空、长度 ≤ 2500，POST `/api/tasks`，body `{ prompt, image: null }`
2. 后端检查 in-flight 锁；有则 409，无则锁住
3. 后端 INSERT `tasks` 行（`status=pending`），生成 `id`
4. 后端启 BackgroundTask `orchestrate(task_id)`
5. 后端立即返回 `{ id, status: pending }`
6. 前端进入"进度态"，5 秒间隔轮询 GET `/api/tasks/{id}`
7. BackgroundTask 内部：
   - 调 `submit_kling_task(prompt=...)` → 拿到 `modelverse_task_id`，UPDATE 行（status=`running`，回填 modelverse_task_id）
   - 进入轮询循环：每 10 秒调 `query_kling_task`，5 分钟硬超时
   - 拿到 `task_status=Success` → 取 `urls[0]` → `httpx.stream` 拉 mp4 → `ufile.putstream(BUCKET, "videos/{id}.mp4", stream, header={"Content-Type":"video/mp4"})` → UPDATE 行（status=`success`、object_key、finished_at）
   - 拿到 `task_status=Failure` 或超时 → UPDATE 行（status=`failure`、error_message、finished_at）
   - finally：释放 in-flight 锁
8. 前端轮询到 `status=success` → 调 GET `/api/tasks/{id}/play_url` 拿 URL → 喂给 `<video>` 播放 → 同时把 `{id, prompt, ..., finishedAt}` 写入 IndexedDB
9. 前端轮询到 `status=failure` → 弹错误提示，**不写 IndexedDB**

### 提交一个图生视频任务

与文生差异仅两处：
- 前端 `<input type="file">` 选图后用 `FileReader.readAsDataURL` 读出 base64，截掉 `data:image/...;base64,` 前缀，POST 请求 body 多 `image` 字段
- 后端 `submit_kling_task` 把 `parameters.image` 一起传

> 图大小硬卡 10MB（base64 后请求体 ~13MB），FastAPI 默认 body 上限要确认放开。短边 ≥ 300、宽高比 1:2.5～2.5:1 由 ModelVerse 自己校验，前端不预校。

### 历史回放 / 下载

1. 前端从 IndexedDB 读历史索引列表
2. 用户点某项 → 调 GET `/api/tasks/{id}/play_url` → 拿到带 Expires 的 URL
3. 播放：`<video src={url} controls />`
4. 下载：用同一 URL，`<a href={url} download={...}>` 触发浏览器下载

### 删除 / 重命名

- 删除：DELETE `/api/tasks/{id}` → 后端删 UFile 对象 + 删 SQLite 行 → 前端删 IndexedDB 索引
- 重命名：PATCH `/api/tasks/{id}` → 后端 UPDATE → 前端更新 IndexedDB

### 应用启动

- 后端：启动时 `db.init()` 建表（如果不存在）；如发现 SQLite 中存在 `running` 状态的行（上次进程崩溃遗留）→ 一律标记为 `failure`，error_message=`"interrupted_by_restart"`
- 前端：加载时读 IndexedDB 渲染历史；同时调 `GET /api/tasks` 与 IndexedDB diff，**以 IndexedDB 为准**（后端可能有用户已在别的浏览器删过的旧记录，但 MVP 单浏览器不会冲突；如果要追求一致性，可以让前端用后端列表覆盖 IndexedDB，留到执行时小决策）

## 非功能性约束

- **安全**：API Key / UFile 公私钥仅在后端环境变量；前端代码**不得**出现任何外部凭证。
- **CORS**：开发期允许 `http://localhost:5173`；UFile bucket 必须配 CORS（GET/HEAD + Range，暴露 `Content-Length` / `Content-Range` / `Accept-Ranges`），否则 `<video>` seek 会断。
- **请求体上限**：FastAPI 默认 1MB，需要在中间件层调到 ≥ 15MB（覆盖 10MB 图 base64 后膨胀）。
- **超时与重试**：
  - ModelVerse 提交：30s 网络超时，不自动重试（用户感知，让前端弹错由用户重提）
  - ModelVerse 轮询：每次 30s 网络超时，单次失败不中断循环（连续 3 次失败再判任务失败）
  - 任务硬超时：5 分钟（300 秒）
  - UFile 上传：300s 超时，失败一次重试一次
- **可观测**：后端结构化日志输出 `task_id` / `modelverse_task_id` / `status` / `duration_ms` / `request_id`（来自 ModelVerse 响应）。
- **部署**：MVP 阶段假设单机部署（前端 `vite build` 静态，后端 `uvicorn` 起一个进程）。in-flight 锁是进程内锁，**不支持多进程**——这是有意为之的简化。

## 决策清单

- **选 `kling-v3` 不选 omni / motion-control / o1**：单 model id 覆盖文生 + 图生，文生/图生切换零分支，对应"参数不暴露给用户"的需求最自然。详见 `research/ucloud-modelverse-kling.md` §3。
- **选官方 `ufile` SDK 不选 boto3 + S3 兼容层**：项目已锁 UCloud 账号体系，可移植性优势不成立；`putstream` + `private_url` 比 boto3 三件套（`addressing_style` + `signature_version` + `endpoint_url`）简单。详见 `research/ucloud-ufile-python.md` §3。
- **视频转存到 UFile 不只存 ModelVerse 临时 URL**：临时 URL 会过期（具体上限未确认），存 URL 几天后历史会全部 404。这是必须做的转存，不是可选优化。
- **后端持久化用 SQLite 不全内存**：MVP 也要避免"开发期重启一次就丢任务关联"。SQLite 单文件、零运维、Python 标准库自带。
- **状态推送用前端轮询不用 SSE / WebSocket**：5 秒一次 GET 对单用户场景完全够，SSE 引入连接管理与异常恢复，对 MVP 是负担。
- **后台轮询用 FastAPI BackgroundTasks 不用 Celery**：MVP 单进程、单任务串行，BackgroundTasks 足够。重启丢 in-flight 任务是已知 trade-off，启动时把 `running` 行扫成 `failure`。
- **前端历史索引存 IndexedDB 不存视频本体**：与"视频本体存 UFile"配合，前端不爆配额；删除/重命名走后端为单一权威源，前端索引只是缓存。
- **失败任务保留 SQLite 行但不进历史**：满足需求"失败不入库"的用户感知，又保留了排查能力。

## 留到执行时再决定

下列项官方文档没明示或与具体环境强相关，**进入 `/cadence:run` 后由 task-executor 在第一次联调中确认或试错**，DESIGN 不预先拍板：

- **ModelVerse 单账号视频任务并发 / QPS 上限**：本设计已用进程内串行锁强约束并发=1，理论上不会触发，但若联调出现 429 需要观察并加退避。
- **UFile 预签名 URL 过期上限**：本设计签发 1 小时（3600s）；如 US3 不允许这么长，需联调时降到允许的最大值。
- **UFile cn-bj region HTTPS 是否支持**：若不支持需要换 region 或临时降级 HTTP。
- **ModelVerse 视频任务 P95 实际耗时**：当前用 5 分钟硬超时，若实际多数任务 < 1 分钟可后续把硬超时调短；若多数任务 > 5 分钟需延长。
- **`<video>` 在 UFile 私有 URL 上的实际表现**：CORS 配齐后 seek / 下载是否正常，需在浏览器实测。
- **后端启动时对历史 `running` 行的处理策略**：当前选"标记为 failure"；如运营上希望能恢复（断点续轮询）可改为重新进入轮询循环——MVP 不做。
- **前端 IndexedDB 与后端列表 diff 的策略**：MVP 默认以 IndexedDB 为准；如果发现误差累积，再切换为"前端覆盖式以后端为准"。
- **bucket 名 / region 具体值**：取决于用户控制台实际创建；通过环境变量传入。

## 视觉契约

| 字段 | 取值 |
|---|---|
| 风格基调 | minimal-refined |
| 明暗主调 | 浅色 |
| 主导色色系 | 冷色系 |
| accent 用途 | 主 CTA / 焦点态 / 关键状态指示 |
| 字体倾向 | 无衬线 |

> 视觉契约是跨 cycle 沿用的硬约束。task-executor 在前端 task 中遵守本契约的 5 个字段，spacing 具体值、字号具体 px、weight、radius、shadow、motion 等实现细节由 executor 结合 frontend-design skill 决定。
