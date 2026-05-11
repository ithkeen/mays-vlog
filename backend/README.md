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
├── pyproject.toml      # 依赖与项目元数据
└── app/
    ├── __init__.py
    ├── main.py         # FastAPI 入口：CORS、请求体上限、/healthz、启动钩子
    ├── config.py       # pydantic-settings 读 .env，启动期校验必填字段
    ├── api/            # 业务路由（T7 填充）
    ├── services/       # ModelVerse / UFile / 编排器 / 串行锁（T4/T5/T6 填充）
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

## 后续任务衔接

- T4：在 `app/services/modelverse.py` 落 ModelVerse 客户端
- T5：在 `app/services/ufile.py` 落 UFile 客户端
- T6：在 `app/services/orchestrator.py` 与 `app/services/lock.py` 落后台编排与串行锁
- T7：在 `app/api/tasks.py` 落 `/api/tasks` 系列路由并挂载到 `main.py`

每个后续 task 完成时，会回到本 README 更新对应章节。
