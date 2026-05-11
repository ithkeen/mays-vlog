# `app/storage/`

后端持久层：SQLite 单文件 `tasks.db`，存储任务元数据。

## 内容

- `db.py`：建表、启动孤儿清理、仓储函数
- `__init__.py`：空，通过 `from app.storage import db` 使用

## 表结构（DESIGN「数据模型 / SQLite」）

字段类型严格对齐设计文档，时间字段为 **unix 秒（INTEGER）**，不是 ISO 字符串。

| 字段 | 类型 | 备注 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID，由编排层生成 |
| `modelverse_task_id` | `TEXT NULL` | ModelVerse 返回的任务 id，提交成功后回填 |
| `prompt` | `TEXT` NOT NULL | |
| `has_image` | `INTEGER` NOT NULL | 0 / 1 布尔 |
| `status` | `TEXT` NOT NULL | `pending` / `running` / `success` / `failure` |
| `error_message` | `TEXT NULL` | 失败时填入 |
| `ufile_object_key` | `TEXT NULL` | 如 `videos/<id>.mp4` |
| `title` | `TEXT NULL` | 用户自定义标题 |
| `created_at` | `INTEGER` NOT NULL | unix 秒 |
| `finished_at` | `INTEGER NULL` | unix 秒 |

## 数据库文件路径

由 `Settings.TASKS_DB_PATH` 决定（见 `app/config.py`），默认 `backend/tasks.db`。
相对路径会被 `resolve_db_path()` 锚定到项目根（与 `.env` 同源），
因此 uvicorn 从 `backend/` 或项目根启动都命中同一文件。`*.db` 已在根
`.gitignore` 中屏蔽，不进版本控制。

## 启动钩子（由 `app/main.py` 的 `lifespan` 调用）

1. `init_db()` — `CREATE TABLE IF NOT EXISTS tasks(...)`
2. `mark_orphans_failed()` — 把 `status IN ('pending','running')` 的旧行
   （上次进程崩溃 / 重启遗留）置为 `failure`，`error_message='interrupted_by_restart'`，
   `finished_at=<当前 unix 秒>`。返回被清理行数，日志中可见。

## 对外函数（被 T6 编排 / T7 路由调用）

```python
from app.storage import db

db.init_db()
db.mark_orphans_failed() -> int

db.create_task(task_id: str, prompt: str, has_image: bool, created_at: int | None = None) -> None
db.get_task(task_id: str) -> dict | None
db.list_success_tasks() -> list[dict]   # 仅 success，按 finished_at DESC

db.update_task_status(task_id: str, status: str, *, error_message: str | None = None, finished_at: int | None = None) -> None
db.update_modelverse_id(task_id: str, modelverse_task_id: str) -> None
db.update_ufile_key(task_id: str, object_key: str) -> None
db.update_task_title(task_id: str, title: str) -> None
db.delete_task(task_id: str) -> None

db.resolve_db_path() -> Path  # 供启动日志显示
```

## 连接管理

模块级 `_connect()` 上下文管理器：每次调用打开独立连接、正常退栈 `commit()`、
异常退栈 `rollback()`、最终 `close()`。行工厂为 `sqlite3.Row`，
`dict(row)` 即可得到字段名映射。父目录不存在时自动创建。

## 并发说明

FastAPI + 单进程单 event loop + MVP 单用户串行任务场景下，SQLite 的
默认锁机制足够。每次仓储调用是短事务，不持有跨请求的连接。
