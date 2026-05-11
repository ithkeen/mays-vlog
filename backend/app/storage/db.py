"""SQLite 持久层：``tasks`` 表的建表、孤儿清理与仓储函数。

设计要点
========
- 字段类型严格对齐 DESIGN「数据模型 / SQLite」：``id TEXT PK``、
  ``has_image INTEGER`` (0/1)、``created_at`` / ``finished_at`` 用
  **unix 秒**（INTEGER），不是 ISO 字符串。
- 数据库文件路径由 ``settings.TASKS_DB_PATH`` 决定，默认
  ``backend/tasks.db``；相对路径会锚定到项目根。
- 连接管理通过 ``_connect()`` 上下文管理器统一封装：每次调用打开
  独立连接，正常出栈 ``commit()``、异常出栈 ``rollback()``，最终关闭。
  SQLite 单连接在短事务里很快，每次重开是 MVP 取舍。

模块对外接口（被 ``main.py`` 启动钩子与后续 T6/T7 调用）：

- ``init_db()``：``CREATE TABLE IF NOT EXISTS tasks``。
- ``mark_orphans_failed() -> int``：把所有
  ``status IN ('pending','running')`` 的旧行置为 ``failure``、
  写入 ``error_message='interrupted_by_restart'`` 与当前
  ``finished_at``，返回被清理的行数。
- ``create_task(id, prompt, has_image, created_at=None)``：插入
  ``status='pending'`` 行。
- ``get_task(id) -> dict | None``。
- ``list_success_tasks() -> list[dict]``：仅 ``success``，按
  ``finished_at DESC``。
- ``update_task_status(id, status, error_message=None, finished_at=None)``。
- ``update_modelverse_id(id, modelverse_task_id)``。
- ``update_ufile_key(id, object_key)``。
- ``update_task_title(id, title)``。
- ``delete_task(id)``。
- ``resolve_db_path() -> Path``：返回当前生效的 db 文件绝对路径，
  供启动日志显示。
"""
from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.config import PROJECT_ROOT, settings

__all__ = [
    "init_db",
    "mark_orphans_failed",
    "create_task",
    "get_task",
    "list_success_tasks",
    "update_task_status",
    "update_modelverse_id",
    "update_ufile_key",
    "update_task_title",
    "delete_task",
    "resolve_db_path",
]


# DESIGN「数据模型 / SQLite」字段定义。
# 注意：created_at / finished_at 是 unix 秒（INTEGER），不是 ISO 字符串。
_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    modelverse_task_id TEXT,
    prompt TEXT NOT NULL,
    has_image INTEGER NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    ufile_object_key TEXT,
    title TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
)
"""


def resolve_db_path() -> Path:
    """把 ``settings.TASKS_DB_PATH`` 解析为绝对路径。

    相对路径锚定在项目根目录（``app.config.PROJECT_ROOT``），
    这样 uvicorn 无论从 ``backend/`` 还是项目根启动都能命中同一文件。
    """
    raw = settings.TASKS_DB_PATH
    p = Path(raw)
    if not p.is_absolute():
        p = PROJECT_ROOT / p
    return p


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    """打开一条 SQLite 连接的上下文管理器。

    - 自动创建父目录（首次启动 ``backend/tasks.db`` 父目录已存在，
      但保留这步让 ``TASKS_DB_PATH`` 指到不存在的子目录时也能工作）。
    - 行工厂用 ``sqlite3.Row``，``dict(row)`` 即可得到字段名映射。
    - 正常退出 ``commit()``、异常退出 ``rollback()``，``finally`` 必关。
    """
    db_path = resolve_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """建表（IF NOT EXISTS）。"""
    with _connect() as conn:
        conn.execute(_CREATE_TABLE_SQL)


def mark_orphans_failed() -> int:
    """启动时孤儿清理。

    扫描 ``status IN ('pending','running')`` 的旧行，全部置为
    ``failure``、``error_message='interrupted_by_restart'``、
    ``finished_at=now``，返回被清理的行数（可能为 0）。
    """
    now = int(time.time())
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE tasks "
            "SET status = 'failure', "
            "    error_message = 'interrupted_by_restart', "
            "    finished_at = ? "
            "WHERE status IN ('pending', 'running')",
            (now,),
        )
        return cur.rowcount


def create_task(
    task_id: str,
    prompt: str,
    has_image: bool,
    created_at: int | None = None,
) -> None:
    """插入一行 ``status='pending'`` 任务。

    ``created_at`` 留空时取当前 unix 秒。
    """
    if created_at is None:
        created_at = int(time.time())
    with _connect() as conn:
        conn.execute(
            "INSERT INTO tasks "
            "(id, prompt, has_image, status, created_at) "
            "VALUES (?, ?, ?, 'pending', ?)",
            (task_id, prompt, 1 if has_image else 0, created_at),
        )


def get_task(task_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        return dict(row) if row else None


def list_success_tasks() -> list[dict]:
    """仅返回 ``status='success'`` 的行，按 ``finished_at DESC``。"""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks "
            "WHERE status = 'success' "
            "ORDER BY finished_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def update_task_status(
    task_id: str,
    status: str,
    *,
    error_message: str | None = None,
    finished_at: int | None = None,
) -> None:
    """更新状态及可选的失败原因 / 终止时间。

    传 ``None`` 的字段不会被写入（保留原值）。这样 T6 可以用
    一个函数表达：``running``（只改 status）、终态 success / failure
    （改 status + error_message + finished_at）。
    """
    fields = ["status = ?"]
    values: list = [status]
    if error_message is not None:
        fields.append("error_message = ?")
        values.append(error_message)
    if finished_at is not None:
        fields.append("finished_at = ?")
        values.append(finished_at)
    values.append(task_id)
    with _connect() as conn:
        conn.execute(
            f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?",
            values,
        )


def update_modelverse_id(task_id: str, modelverse_task_id: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE tasks SET modelverse_task_id = ? WHERE id = ?",
            (modelverse_task_id, task_id),
        )


def update_ufile_key(task_id: str, object_key: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE tasks SET ufile_object_key = ? WHERE id = ?",
            (object_key, task_id),
        )


def update_task_title(task_id: str, title: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE tasks SET title = ? WHERE id = ?",
            (title, task_id),
        )


def delete_task(task_id: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
