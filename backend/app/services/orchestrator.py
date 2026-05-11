"""任务编排服务（后台任务 + 串行锁 + 超时）。

本模块串起 T3（持久层）、T4（ModelVerse 客户端）、T5（UFile 客户端），
对外暴露给 T7 路由层三件东西：

- ``submit_task(prompt, image_base64, background_tasks)``：抢锁 + 入库
  ``status='pending'`` + 调度后台 ``_run_orchestration`` + 立即返回
- ``get_play_url_for_task(task_id)``：仅 ``success`` 任务调 T5 签发 1 小时
  预签名 GET URL；否则抛 ``TaskNotPlayableError``
- ``in_flight``：模块级单例状态对象（``lock`` + ``current_task_id``），
  路由层可读 ``current_task_id`` 用于 409 响应体

并发模型
========
- 进程内 ``asyncio.Lock`` 强约束并发=1（DESIGN「决策清单」/「非功能性约束」）
- ``submit_task`` 端点本身在 FastAPI 单事件循环串行执行，所以
  ``if lock.locked(): raise ... else: await lock.acquire()`` 这种
  check-then-acquire 在本场景下是安全的——两次 ``submit_task`` 不会
  穿插执行，第二个调用一定看到第一个 acquire 后的状态
- 注意：``asyncio.Lock`` 没有 ``blocking=False`` 参数（threading.Lock 才有），
  必须用 ``locked()`` 自检

后台任务流程（``_run_orchestration``）
========
1. 调 ``submit_kling_task`` → 成功后回填 ``modelverse_task_id`` + 置
   ``status='running'``
2. 轮询循环：每 10 秒调一次 ``query_kling_task``，硬上限 300 秒（DESIGN
   「非功能性约束 / 超时与重试」）；单次 ``ModelVerseError`` 计入连续
   失败次数，**连续 3 次**才把任务判 failure（成功一次清零，避免瞬时网络
   抖动误杀任务）
3. 命中 ``status='success'`` → ``upload_video_from_url`` 把视频从 ModelVerse
   临时 URL 转存到 ``videos/{task_id}.mp4`` → 回填 ``ufile_object_key`` +
   置 ``status='success'`` + 写 ``finished_at``
4. 超时 / 真失败 / 任意未捕获异常 → 置 ``status='failure'`` + ``error_message``
   + ``finished_at``
5. finally：清空 ``current_task_id`` + 释放锁

注意：``query_kling_task`` 在上游 ``task_status='Failure'`` 时**抛**
``ModelVerseError``（不返回 ``status='failure'``），所以"任务真失败"也走
连续失败计数路径——下一轮 query 会再抛同一个 Failure 异常，最迟 ~30 秒
后判定。这是 T4 接口归一化的有意设计，避免上层把网络抖动误判为任务永久失败。
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field

from fastapi import BackgroundTasks

from app.services.modelverse import (
    ModelVerseError,
    query_kling_task,
    submit_kling_task,
)
from app.services.ufile import get_play_url, upload_video_from_url
from app.storage.db import (
    create_task,
    get_task,
    update_modelverse_id,
    update_task_status,
    update_ufile_key,
)

__all__ = [
    "ConcurrentTaskError",
    "TaskNotPlayableError",
    "InFlightState",
    "in_flight",
    "submit_task",
    "get_play_url_for_task",
    "POLL_INTERVAL_SECONDS",
    "POLL_HARD_TIMEOUT_SECONDS",
    "MAX_CONSECUTIVE_QUERY_FAILURES",
]

logger = logging.getLogger("app.orchestrator")

# 单次轮询间隔（秒）。DESIGN「关键流程」明确每 10 秒一次。
POLL_INTERVAL_SECONDS: float = 10.0

# 任务硬超时（秒）。DESIGN「非功能性约束 / 超时与重试」明确 5 分钟。
POLL_HARD_TIMEOUT_SECONDS: float = 300.0

# 单次 ``ModelVerseError``（含网络异常 / HTTP 4xx-5xx / 上游 Failure）
# **连续** 多少次才计入任务失败。成功一次清零。
MAX_CONSECUTIVE_QUERY_FAILURES: int = 3


# --- 异常类型 ---------------------------------------------------------------


class ConcurrentTaskError(Exception):
    """当前已有 in-flight 任务，无法提交新任务。

    路由层捕获后转为 HTTP 409，响应体 ``{"error": "task_in_progress",
    "current_task_id": <str>}`` —— ``current_task_id`` 字段必须保留，
    前端可据此显示当前正在跑的任务。
    """

    def __init__(self, current_task_id: str) -> None:
        self.current_task_id = current_task_id
        super().__init__(
            f"task already in progress: current_task_id={current_task_id}"
        )


class TaskNotPlayableError(Exception):
    """任务当前状态不允许签发播放 URL（不存在 / 还没成功）。

    路由层捕获后转为 HTTP 404 ``{"error": "task_not_playable"}``——
    DESIGN「接口设计」明确 ``/api/tasks/{id}/play_url`` 仅 ``success``
    返回 200，其它（含不存在、非 success）一律 404。
    """

    def __init__(self, task_id: str, status: str | None) -> None:
        self.task_id = task_id
        self.status = status
        super().__init__(
            f"task not playable: task_id={task_id} status={status!r}"
        )


# --- 模块级 in-flight 状态对象 ---------------------------------------------


@dataclass
class InFlightState:
    """模块级 in-flight 状态对象。

    - ``lock``：``asyncio.Lock``，串行化任务提交
    - ``current_task_id``：当前正在跑的任务 id；锁未持有时为 ``None``
    """

    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    current_task_id: str | None = None


in_flight = InFlightState()


# --- 公开 API ---------------------------------------------------------------


async def submit_task(
    prompt: str,
    image_base64: str | None,
    background_tasks: BackgroundTasks,
) -> dict:
    """提交一个新任务并把后台编排丢给 ``background_tasks`` 调度。

    步骤：

    1. 锁已被持有 → 抛 ``ConcurrentTaskError``（不阻塞，立即失败）
    2. ``await lock.acquire()`` 抢锁；抢到后生成 UUID
    3. ``create_task`` INSERT 一行 ``status='pending'``
    4. ``background_tasks.add_task(_run_orchestration, ...)`` 调度后台
    5. 立即返回 ``{id, status: "pending", current_task_id}``

    抢锁后如果 ``create_task`` 抛异常会释放锁后再 raise——避免把死锁
    遗留给后续请求。
    """
    # 注意：必须用 ``locked()`` 自检；asyncio.Lock 没有 ``blocking=False``
    # 参数。FastAPI 单事件循环串行执行 submit_task，所以 check-then-acquire
    # 不会有 race（第二个 submit 一定看到第一个 acquire 后的状态）。
    if in_flight.lock.locked():
        # current_task_id 在持锁期间保证非空（acquire 后立刻设置）
        current = in_flight.current_task_id or ""
        raise ConcurrentTaskError(current_task_id=current)

    await in_flight.lock.acquire()
    try:
        task_id = str(uuid.uuid4())
        in_flight.current_task_id = task_id
        has_image = image_base64 is not None
        create_task(task_id, prompt, has_image)
    except Exception:
        # 抢锁后入库失败 → 必须释放锁，否则后续请求被永久卡住
        in_flight.current_task_id = None
        in_flight.lock.release()
        raise

    background_tasks.add_task(
        _run_orchestration, task_id, prompt, image_base64
    )
    logger.info("task submitted task_id=%s has_image=%s", task_id, has_image)
    return {"id": task_id, "status": "pending", "current_task_id": task_id}


def get_play_url_for_task(task_id: str) -> str:
    """仅 ``success`` 任务返回 1 小时预签名 GET URL；否则抛 ``TaskNotPlayableError``。

    路由层会把 ``TaskNotPlayableError`` 统一转 404。本函数同步即可
    （UFile SDK 的 ``private_download_url`` 是同步的，且预签名计算不发请求）。
    """
    task = get_task(task_id)
    if task is None:
        raise TaskNotPlayableError(task_id=task_id, status=None)
    if task["status"] != "success":
        raise TaskNotPlayableError(task_id=task_id, status=task["status"])
    object_key = task.get("ufile_object_key")
    if not object_key:
        # success 但 ufile_object_key 缺失——理论不会发生，但留个保险
        raise TaskNotPlayableError(task_id=task_id, status=task["status"])
    return get_play_url(object_key, 3600)


# --- 后台编排 ---------------------------------------------------------------


def _now() -> int:
    """当前 unix 秒。封装成函数方便测试 monkeypatch（虽然本 task 没用到）。"""
    return int(time.time())


def _fail_task(task_id: str, error_message: str) -> None:
    """把任务标记为 failure，附 error_message 与 finished_at。"""
    try:
        update_task_status(
            task_id,
            "failure",
            error_message=error_message,
            finished_at=_now(),
        )
    except Exception:
        # 入库本身失败也别再抛——finally 还要释放锁
        logger.exception(
            "failed to mark task as failure task_id=%s", task_id
        )


async def _run_orchestration(
    task_id: str, prompt: str, image_base64: str | None
) -> None:
    """后台编排协程：提交 → 轮询 → 转存 / 失败 / 超时 → 释放锁。

    任何分支退出前必须经过 finally：清空 ``in_flight.current_task_id`` 与
    释放 ``in_flight.lock``。
    """
    try:
        # 1. 提交 ModelVerse 任务
        try:
            modelverse_task_id = await submit_kling_task(prompt, image_base64)
        except ModelVerseError as exc:
            # 提交失败 → 直接落 failure，不进入轮询
            logger.warning(
                "submit_kling_task failed task_id=%s err=%s", task_id, exc
            )
            _fail_task(task_id, str(exc))
            return
        update_modelverse_id(task_id, modelverse_task_id)
        update_task_status(task_id, "running")
        logger.info(
            "task running task_id=%s modelverse_task_id=%s",
            task_id,
            modelverse_task_id,
        )

        # 2. 轮询循环
        deadline = time.monotonic() + POLL_HARD_TIMEOUT_SECONDS
        consecutive_failures = 0

        while True:
            if time.monotonic() >= deadline:
                logger.warning("task timeout task_id=%s", task_id)
                _fail_task(task_id, "timeout")
                return

            await asyncio.sleep(POLL_INTERVAL_SECONDS)

            try:
                res = await query_kling_task(modelverse_task_id)
                consecutive_failures = 0  # 一次成功重置计数
            except ModelVerseError as exc:
                consecutive_failures += 1
                logger.info(
                    "query failure %d/%d task_id=%s err=%s",
                    consecutive_failures,
                    MAX_CONSECUTIVE_QUERY_FAILURES,
                    task_id,
                    exc,
                )
                if consecutive_failures >= MAX_CONSECUTIVE_QUERY_FAILURES:
                    _fail_task(task_id, str(exc))
                    return
                continue

            status = res["status"]
            if status == "success":
                video_url = res["video_url"]
                if not video_url:
                    # 理论上 T4 不会返回 success 但 video_url 为空
                    _fail_task(task_id, "success without video_url")
                    return
                object_key = f"videos/{task_id}.mp4"
                upload_video_from_url(video_url, object_key)
                update_ufile_key(task_id, object_key)
                update_task_status(
                    task_id, "success", finished_at=_now()
                )
                logger.info(
                    "task success task_id=%s object_key=%s",
                    task_id,
                    object_key,
                )
                return
            # status == "pending" / "running" → 继续下一轮
    except Exception as exc:  # noqa: BLE001 - 兜底保证 finally 能释放锁
        logger.exception(
            "unexpected error during orchestration task_id=%s", task_id
        )
        _fail_task(task_id, str(exc))
    finally:
        in_flight.current_task_id = None
        if in_flight.lock.locked():
            in_flight.lock.release()
