# backend/

后端：Python 3.11+ / FastAPI 薄代理。

承担三件不能放前端的事：
1. 持有 `MODELVERSE_API_KEY` 与 UFile 公私钥；
2. 异步轮询 ModelVerse 视频任务（1～5 分钟）；
3. 把成功视频从 ModelVerse 临时 URL 转存到 UCloud UFile，按需签发可播放的私有 URL 给前端。

## 目录结构

```
backend/
├── README.md           # 本文档
├── CORS.md             # UFile bucket CORS 最小配置（视频播放必需，T5 产物）
├── pyproject.toml      # 依赖与项目元数据（含 [project.optional-dependencies].dev）
├── tests/              # pytest 测试（T6 起开始落地）
│   └── test_orchestrator.py
└── app/
    ├── __init__.py
    ├── main.py         # FastAPI 入口：CORS、请求体上限、/healthz、启动钩子
    ├── config.py       # pydantic-settings 读 .env，启动期校验必填字段
    ├── api/            # 业务路由（T7 填充）
    ├── services/       # ModelVerse / UFile / 编排器（README 见 app/services/README.md）
    │   ├── modelverse.py   # T4：kling-v3 提交 + 轮询客户端
    │   ├── ufile.py        # T5：UFile 客户端（流式上传 / 预签名 URL / 删除）
    │   └── orchestrator.py # T6：单任务编排（BackgroundTask + asyncio.Lock + 轮询 + 超时）
    └── storage/        # SQLite 初始化、tasks 表 CRUD、启动孤儿清理（T3 落地）
```

## 依赖安装

依赖在 `pyproject.toml` 中声明，至少包含：`fastapi`、`uvicorn[standard]`、
`pydantic`、`pydantic-settings`、`httpx`、`ufile`、`requests`。

推荐使用项目根 `.venv`（已由 uv 创建）：

```bash
# 在项目根目录执行
uv pip install -e backend/
```

或使用 pip：

```bash
source .venv/bin/activate
pip install -e backend/
```

测试依赖（pytest + pytest-asyncio）以可选 extras 提供，运行测试前需要：

```bash
uv pip install -e "backend[dev]"
```

## 环境变量

后端启动前需要把以下变量写入项目根 `.env`（可复制项目根 `.env.example` 改名）：

| 变量名 | 说明 |
|---|---|
| `MODELVERSE_API_KEY` | UCloud 星图 ModelVerse 的 API Key |
| `UFILE_PUBLIC_KEY` | UCloud UFile 公钥 |
| `UFILE_PRIVATE_KEY` | UCloud UFile 私钥 |
| `UFILE_BUCKET` | UFile 存储空间名（需在 UCloud 控制台手动创建） |
| `UFILE_REGION` | UFile bucket 所在 region（如 `cn-bj`） |
| `TASKS_DB_PATH` | （可选）SQLite 文件路径，默认 `backend/tasks.db`，相对路径锚定项目根 |

任一必填项缺失，uvicorn 启动会立即抛 `RuntimeError` 并列出缺失变量名。
`.env` 路径锚定在项目根目录（由 `app/config.py` 用 `__file__` 推算），
所以在 `backend/` 或项目根任一目录执行 uvicorn 都能读到。

## 启动命令

```bash
cd backend
uvicorn app.main:app --reload
```

默认监听 `http://127.0.0.1:8000`。

健康检查：

```bash
curl http://127.0.0.1:8000/healthz
# {"status":"ok"}
```

## 请求体上限

中间件 `limit_body_size` 按 `Content-Length` 拒绝超过 **16 MiB** 的请求体，
覆盖 10MB 首帧图 base64 膨胀后（≈ 13.3MB）+ JSON 开销。超限返回 `413`：

```json
{"error": "request_entity_too_large", "max_bytes": 16777216}
```

## CORS

开发期 `CORSMiddleware` 仅允许前端来源 `http://localhost:5173`，允许凭据、
所有方法、所有请求头。

## 启动钩子（持久层）

`app/main.py` 在 FastAPI `lifespan` 中按顺序做两件事：

1. `storage.db.init_db()` — `CREATE TABLE IF NOT EXISTS tasks(...)`
2. `storage.db.mark_orphans_failed()` — 把任何 `status IN ('pending','running')`
   的旧行（上次进程崩溃 / 重启遗留）置为 `failure`，
   `error_message='interrupted_by_restart'`，`finished_at=now`

启动日志样例：

```
INFO app.startup: tasks 表已就绪（db=/.../backend/tasks.db）
INFO app.startup: 启动孤儿清理：已将 0 条 pending/running 旧任务置为 failure
```

## 持久层模块 `app/storage`

文件 `app/storage/db.py` 提供：

- 表结构（DESIGN「数据模型 / SQLite」字段类型严格对齐，时间为 unix 秒）：

  | 字段 | 类型 | 备注 |
  |---|---|---|
  | `id` | `TEXT PRIMARY KEY` | UUID（由 T6 生成） |
  | `modelverse_task_id` | `TEXT NULL` | 提交成功后回填 |
  | `prompt` | `TEXT` NOT NULL | |
  | `has_image` | `INTEGER` NOT NULL | 0/1 |
  | `status` | `TEXT` NOT NULL | `pending` / `running` / `success` / `failure` |
  | `error_message` | `TEXT NULL` | |
  | `ufile_object_key` | `TEXT NULL` | 如 `videos/<id>.mp4` |
  | `title` | `TEXT NULL` | 用户自定义标题 |
  | `created_at` | `INTEGER` NOT NULL | unix 秒 |
  | `finished_at` | `INTEGER NULL` | unix 秒 |

- 仓储函数（每个调用都用 `_connect()` 上下文管理器开短连接 + 自动 commit/rollback）：
  - `init_db()` / `mark_orphans_failed() -> int`
  - `create_task(id, prompt, has_image, created_at=None)`（插入 `status='pending'`）
  - `get_task(id) -> dict | None`
  - `list_success_tasks() -> list[dict]`（仅 success，按 `finished_at DESC`）
  - `update_task_status(id, status, *, error_message=None, finished_at=None)`
  - `update_modelverse_id(id, modelverse_task_id)`
  - `update_ufile_key(id, object_key)`
  - `update_task_title(id, title)`
  - `delete_task(id)`
  - `resolve_db_path() -> Path`（启动日志用）

数据库文件路径由 `Settings.TASKS_DB_PATH` 决定，默认 `backend/tasks.db`；
相对路径锚定到项目根。`*.db` 已被根 `.gitignore` 屏蔽，不会进版本控制。

## ModelVerse 客户端 `app/services/modelverse.py`

封装 UCloud 星图 (UModelVerse) `kling-v3` 视频生成接口，供 T6 的后台编排器调用。

### 端点与鉴权

| 用途 | 方法 + 路径 | 备注 |
|---|---|---|
| 提交 | `POST https://api.modelverse.cn/v1/tasks/submit` | 返回 `output.task_id` |
| 轮询 | `GET https://api.modelverse.cn/v1/tasks/status?task_id=...` | 返回 `output.task_status` 等 |

- Header：`Authorization: Bearer <MODELVERSE_API_KEY>`
- **单次 HTTP 超时 30 秒**（提交 / 轮询共用），匹配 DESIGN「非功能性约束」

### 默认生成参数（模块级常量，不暴露给前端）

| 参数 | 取值 | 备注 |
|---|---|---|
| `mode` | `std` | 720P |
| `aspect_ratio` | `16:9` | 桌面浏览友好 |
| `duration` | `5` 秒 | 模型支持 3~15 |
| `sound` | `off` | MVP 无音频 |

文生 / 图生同一 model id `kling-v3`，靠 `parameters.image` 是否存在自动切换。
图生时传入的 base64 字符串必须**不带** `data:image/...;base64,` 前缀。

### 公开 API

- `async submit_kling_task(prompt: str, image_base64: str | None) -> str`
  - 返回 ModelVerse 任务 ID
- `async query_kling_task(task_id: str) -> TaskStatus`
  - 归一化内部状态：`pending` / `running` / `success`
  - `success` 时 `video_url` 为可直接 GET 的临时 URL
- 类型 `TaskStatus`：`{"status": ..., "video_url": str | None, "error": None}`
- 自定义异常 `ModelVerseError`

### 状态与异常归一化（重要）

| 上游 `task_status` | 内部表现 |
|---|---|
| `Pending` | 返回 `status="pending"` |
| `Running` | 返回 `status="running"` |
| `Success` | 返回 `status="success"` + `video_url=urls[0]` |
| `Failure` | **抛出** `ModelVerseError(error_message)` |

下列三类**统一抛 `ModelVerseError`**，由 T6 的轮询循环决定是否计入失败（区分"瞬时
网络抖动"与"任务真失败"靠 message 文本，而不是返回值上的 `status="failure"`）：

1. 网络异常（`httpx.HTTPError`）
2. HTTP 4xx / 5xx
3. 响应缺关键字段（`task_id` 缺失、`Success` 无 `urls`、未知 `task_status` 等）
4. 上游 `task_status == "Failure"`（message 为 `task failure: <error_message>`）

异常 message 限制在 200 字符以内，避免上游 HTML 错误页污染日志。
**绝不**在客户端层把网络错误转译成 `status="failure"` 返回——上层无法区分时
会把临时抖动误判为任务永久失败。

### CLI 烟雾入口

配齐 `.env` 后从 `backend/` 目录执行：

```bash
python -m app.services.modelverse "A cinematic shot of a futuristic city"
```

将提交一次文生任务并每 10 秒轮询一次，直到 `success` / 任意 `ModelVerseError`
（包括真失败与网络异常）或 5 分钟硬超时。日志只打印 `task_id` 与状态，
不打印 prompt 全文、不打印 API Key。退出码：0=成功，1=失败/超时，2=参数错误。

环境变量缺失时 `app.config` 在 import 阶段即抛 `RuntimeError`，不会进入轮询。

## UFile 客户端 `app/services/ufile.py`

封装 UCloud UFile（US3）对象存储，供 T6 编排器在任务成功时把 ModelVerse 临时
视频转存为可长期播放的私有对象，并签发预签名 URL。底层用官方 `ufile` Python
SDK（不是 boto3）。

### 公开 API

| 函数 | 行为 |
|---|---|
| `upload_video_from_url(source_url, object_key)` | `requests.get(stream=True, timeout=300)` 拉视频 → `putstream` 直传，`Content-Type: video/mp4` |
| `get_play_url(object_key, expires_seconds=3600)` | 返回 UFile 私有 bucket 的预签名 GET URL（带 `Expires` / `Signature`） |
| `delete_object(object_key)` | 删除对象；HTTP 404（对象不存在）视为成功 |

所有失败统一抛 `UFileError`，message 形如 `UFile <operation> failed for
object_key='...': <detail>`。

### 关键实现约束

1. **`Content-Type: video/mp4` 必须用 `mime_type=` 参数传**：SDK 的 `putstream`
   内部会用 `header['Content-Type'] = mime_type` 覆写任何外部传入的 `Content-Type`
   头，且 `mime_type` 默认 `application/octet-stream`。本模块显式 `mime_type=
   "video/mp4"`，否则浏览器 `<video>` 可能识别失败。
2. **失败重试 1 次**：`requests.RequestException` 与 UFile SDK 抛错 / 软失败
   （`ResponseInfo.ok() == False`）都计入失败；第一次失败 sleep 1s 后重试一次，
   仍失败抛 `UFileError`。整体请求 timeout 上限 300s（DESIGN「非功能性约束」）。
3. **`config.set_default(...)` 全局可变状态**：`get_play_url` 内部要临时设置
   `expires=expires_seconds`，全程用模块级 `threading.Lock` 串行化 set_default →
   `private_download_url` 序列；同时**必须显式重传** `open_ssl=True`，否则
   SDK 的 `open_ssl` 形参默认为 `False`（非 None），会被无条件重置回 HTTP。
4. **`delete_object` 对 404 容忍**：用户连续点删除、或控制台已手动清过的情况
   不应误抛错误；其它非 ok 状态（401/403/5xx 等）仍抛 `UFileError`。

### CORS（视频播放必需）

UFile bucket 必须配最小 CORS 规则，浏览器 `<video>` 才能跨域拉到预签名 URL
的 Range 响应。详见 **[`backend/CORS.md`](./CORS.md)**——含开发期 / 生产期
建议、字段含义、控制台等价配置、验证步骤与常见故障对照。

## 后续任务衔接

- T7：在 `app/api/tasks.py` 落 `/api/tasks` 系列路由并挂载到 `main.py`

每个后续 task 完成时，会回到本 README 更新对应章节。

## 任务编排器 `app/services/orchestrator.py`

T6 把 T3（持久层）、T4（ModelVerse 客户端）、T5（UFile 客户端）串成单任务
编排管线，对外暴露给 T7 路由层：

### 公开 API

| 符号 | 说明 |
|---|---|
| `async submit_task(prompt, image_base64, background_tasks) -> dict` | 抢锁 → 入库 `pending` → 调度后台 `_run_orchestration` → 返回 `{id, status:"pending", current_task_id}` |
| `get_play_url_for_task(task_id) -> str` | 仅 `status='success'` 任务签发 1 小时 UFile 预签名 URL；否则抛 `TaskNotPlayableError` |
| `in_flight: InFlightState` | 模块级单例：`lock: asyncio.Lock` + `current_task_id: str \| None` |
| `ConcurrentTaskError(current_task_id)` | 并发冲突；路由层捕获转 409（带 `current_task_id` 字段供前端显示） |
| `TaskNotPlayableError(task_id, status)` | 任务不存在或未成功；路由层捕获转 404 |

### 并发与超时模型

- **进程内 `asyncio.Lock`** 强约束并发 = 1。**注意 `asyncio.Lock` 没有
  `blocking=False` 参数**（threading.Lock 才有），所以非阻塞抢锁的正确写法是：
  ```python
  if in_flight.lock.locked():
      raise ConcurrentTaskError(current_task_id=in_flight.current_task_id)
  await in_flight.lock.acquire()
  ```
  FastAPI 单事件循环串行执行 `submit_task`，check-then-acquire 不会有 race。
- **轮询每 10 秒 一次**，总硬超时 **300 秒**（DESIGN「非功能性约束 / 超时与重试」）。
- **连续 3 次 `ModelVerseError` 才判失败**（成功一次清零）：网络抖动与上游
  `Failure` 都走同一计数路径——T4 客户端不在层内区分两者，由编排层统一兜底。

### 后台编排流程

```
try:
    1. submit_kling_task(prompt, image_base64) -> mv_id
       update_modelverse_id + update_task_status('running')
    2. 轮询循环（最多 300s，间隔 10s）：
       - 任意 ModelVerseError 计入连续失败次数；连续 3 次 -> failure
       - 'success' -> upload_video_from_url -> update_ufile_key
         + update_task_status('success', finished_at=now)
    3. 超时 -> failure + error_message='timeout'
    4. 任意未捕获异常 -> failure + error_message=str(e)
finally:
    in_flight.current_task_id = None
    in_flight.lock.release()
```

`finally` 中始终 release 锁 + 清空 `current_task_id`，保证服务不会因为任意
异常永久卡死。

详细接口约定与测试见 **[`app/services/README.md`](./app/services/README.md)**。

## 测试

`backend/tests/` 用 pytest + pytest-asyncio（auto 模式，无需 `@pytest.mark.asyncio`）。

```bash
cd backend
python -m pytest -v
```

当前覆盖：

- `test_orchestrator.py`：T6 acceptance 两个 case + `get_play_url_for_task`
  对非 success 任务的拒绝路径

测试用 monkeypatch 替换 `submit_kling_task` / `query_kling_task` /
`upload_video_from_url`，不触达真实第三方服务。`TASKS_DB_PATH` 通过 fixture
临时指向 `tmp_path`，不污染 `backend/tasks.db`。
