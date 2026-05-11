"""T6 orchestrator 编排服务测试。

按 T6 acceptance 的两个 case 编写：

- ``test_concurrent_submit_raises``：两个并发 ``submit_task`` 调用中第二个
  抛 ``ConcurrentTaskError`` 且 message 包含当前 in-flight id。
- ``test_success_path_status_transitions``：mock 成功路径下 SQLite 行状态
  依次 ``pending → running → success``，``ufile_object_key`` 被填充。

测试不打真实网络。``modelverse.submit_kling_task`` / ``modelverse.query_kling_task``
/ ``ufile.upload_video_from_url`` 全部用 monkeypatch 替换。
``TASKS_DB_PATH`` 通过环境变量临时指向 tmp_path，避免污染 backend/tasks.db。
"""
from __future__ import annotations

import asyncio
import os
import sqlite3

import pytest


# --- pytest 启动期注入环境变量 ---------------------------------------------
#
# ``app.config`` 在 import 时立刻实例化 ``Settings``，缺失必填字段会
# 抛 RuntimeError。本测试不需要真实凭据，但为了让 import 不炸，提供
# 占位值。``TASKS_DB_PATH`` 每个测试通过 fixture 覆写指向 tmp 文件。

os.environ.setdefault("MODELVERSE_API_KEY", "test-key")
os.environ.setdefault("UFILE_PUBLIC_KEY", "test-pub")
os.environ.setdefault("UFILE_PRIVATE_KEY", "test-priv")
os.environ.setdefault("UFILE_BUCKET", "test-bucket")
os.environ.setdefault("UFILE_REGION", "cn-bj")


# --- fixtures ---------------------------------------------------------------


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """每个测试用独立 sqlite 文件 + 重新建表 + 重置 in-flight 状态。"""
    db_file = tmp_path / "tasks.db"
    # 改 Settings 里的 TASKS_DB_PATH（pydantic-settings 实例可写）
    from app.config import settings

    monkeypatch.setattr(settings, "TASKS_DB_PATH", str(db_file))

    from app.storage import db as storage_db

    storage_db.init_db()

    # 重置 orchestrator 模块的全局 in-flight 状态：测试之间不共享
    from app.services import orchestrator

    # 直接替换为新的 InFlightState，避免上一个测试残留的 locked 状态
    orchestrator.in_flight = orchestrator.InFlightState()
    yield db_file


class _FakeBackgroundTasks:
    """模拟 FastAPI BackgroundTasks，记录被添加的任务到 ``pending`` 列表。

    调 ``run_all()`` 才会真正 await 跑这些任务。这样测试可以观察
    "submit_task 后 / 后台任务跑完前" 的 in-flight 状态。
    """

    def __init__(self) -> None:
        self.pending: list[tuple] = []  # (coro_fn, args, kwargs)

    def add_task(self, func, /, *args, **kwargs) -> None:
        self.pending.append((func, args, kwargs))

    async def run_all(self) -> None:
        while self.pending:
            func, args, kwargs = self.pending.pop(0)
            res = func(*args, **kwargs)
            if asyncio.iscoroutine(res):
                await res


# --- case (a) 并发 submit ---------------------------------------------------


async def test_concurrent_submit_raises(tmp_db):
    """第一个 submit 持锁，第二个 submit 应抛 ConcurrentTaskError。"""
    from app.services import orchestrator

    bg = _FakeBackgroundTasks()

    first = await orchestrator.submit_task("prompt 1", None, bg)
    assert first["status"] == "pending"
    assert first["id"] == first["current_task_id"]
    assert orchestrator.in_flight.lock.locked()
    assert orchestrator.in_flight.current_task_id == first["id"]

    with pytest.raises(orchestrator.ConcurrentTaskError) as exc_info:
        await orchestrator.submit_task("prompt 2", None, bg)

    # message 必须包含当前 in-flight id（路由层会读 current_task_id 字段
    # 放进 409 body；但 acceptance 同时要求 message 也包含）
    assert exc_info.value.current_task_id == first["id"]
    assert first["id"] in str(exc_info.value)

    # 第二个调用不应入库
    with sqlite3.connect(str(tmp_db)) as conn:
        rows = conn.execute("SELECT id FROM tasks").fetchall()
        assert len(rows) == 1
        assert rows[0][0] == first["id"]

    # 清理：手动释放第一个任务的锁，避免影响后续测试
    orchestrator.in_flight.current_task_id = None
    orchestrator.in_flight.lock.release()


# --- case (b) 成功路径 -----------------------------------------------------


async def test_success_path_status_transitions(tmp_db, monkeypatch):
    """mock 成功路径，验证 pending → running → success + ufile_object_key 被填充。

    步骤：
    1. submit_task 立即入库 pending（确认 status='pending'）
    2. 跑后台任务（mock ModelVerse 与 UFile 三个函数）：
       - submit_kling_task 直接返回 mv_id
       - query_kling_task 第一次返回 running，第二次返回 success + video_url
       - upload_video_from_url 直接 return（不真发请求）
    3. 结束后行 status='success'、ufile_object_key='videos/{id}.mp4'、
       finished_at 非空
    """
    from app.services import orchestrator
    from app.services.modelverse import TaskStatus
    from app.storage import db as storage_db

    bg = _FakeBackgroundTasks()

    # mock 三个外部依赖
    async def fake_submit(prompt, image_base64):
        return "mv-task-id-xyz"

    query_states = iter(
        [
            TaskStatus(status="running", video_url=None, error=None),
            TaskStatus(
                status="success",
                video_url="https://modelverse.example/tmp/abc.mp4",
                error=None,
            ),
        ]
    )

    async def fake_query(mv_task_id):
        return next(query_states)

    uploaded: list[tuple[str, str]] = []

    def fake_upload(source_url, object_key):
        uploaded.append((source_url, object_key))

    monkeypatch.setattr(orchestrator, "submit_kling_task", fake_submit)
    monkeypatch.setattr(orchestrator, "query_kling_task", fake_query)
    monkeypatch.setattr(
        orchestrator, "upload_video_from_url", fake_upload
    )
    # 把轮询间隔降到 0，否则要等 10s × 2 = 20s
    monkeypatch.setattr(orchestrator, "POLL_INTERVAL_SECONDS", 0)

    # 1. 提交：立即入库 pending
    res = await orchestrator.submit_task("a prompt", None, bg)
    task_id = res["id"]
    assert res["status"] == "pending"

    row = storage_db.get_task(task_id)
    assert row is not None
    assert row["status"] == "pending"
    assert row["ufile_object_key"] is None
    assert row["finished_at"] is None
    assert row["has_image"] == 0

    # 2. 跑后台任务（FakeBackgroundTasks 会真正 await）
    await bg.run_all()

    # 3. 终态检查
    row = storage_db.get_task(task_id)
    assert row is not None
    assert row["status"] == "success"
    assert row["modelverse_task_id"] == "mv-task-id-xyz"
    assert row["ufile_object_key"] == f"videos/{task_id}.mp4"
    assert row["finished_at"] is not None
    assert row["error_message"] is None

    # 转存调用参数对了
    assert uploaded == [
        (
            "https://modelverse.example/tmp/abc.mp4",
            f"videos/{task_id}.mp4",
        )
    ]

    # 锁与 current_task_id 已释放，可继续接新任务
    assert not orchestrator.in_flight.lock.locked()
    assert orchestrator.in_flight.current_task_id is None

    # get_play_url_for_task 应当能签发（mock 一下底层 get_play_url）
    monkeypatch.setattr(
        orchestrator,
        "get_play_url",
        lambda object_key, expires: f"https://signed.example/{object_key}?e={expires}",
    )
    url = orchestrator.get_play_url_for_task(task_id)
    assert url == f"https://signed.example/videos/{task_id}.mp4?e=3600"


async def test_get_play_url_for_task_rejects_non_success(tmp_db, monkeypatch):
    """get_play_url_for_task 仅对 success 任务签发；其它一律抛 TaskNotPlayableError。"""
    from app.services import orchestrator
    from app.storage import db as storage_db

    # 不存在
    with pytest.raises(orchestrator.TaskNotPlayableError):
        orchestrator.get_play_url_for_task("nonexistent")

    # 存在但 status='pending'
    storage_db.create_task("t-pending", "p", has_image=False)
    with pytest.raises(orchestrator.TaskNotPlayableError):
        orchestrator.get_play_url_for_task("t-pending")

    # 存在 status='failure'
    storage_db.create_task("t-fail", "p", has_image=False)
    storage_db.update_task_status(
        "t-fail", "failure", error_message="boom", finished_at=1
    )
    with pytest.raises(orchestrator.TaskNotPlayableError):
        orchestrator.get_play_url_for_task("t-fail")
