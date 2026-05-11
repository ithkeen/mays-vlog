"""ModelVerse 客户端：调用 UCloud 星图 (UModelVerse) kling-v3 视频生成接口。

端点
----
- 提交: ``POST https://api.modelverse.cn/v1/tasks/submit``
- 轮询: ``GET  https://api.modelverse.cn/v1/tasks/status?task_id=...``

鉴权
----
Header: ``Authorization: Bearer <MODELVERSE_API_KEY>``

默认生成参数（模块级常量；本 MVP 不暴露给用户）
----
- ``mode``         = ``"std"``   （720P，最便宜）
- ``aspect_ratio`` = ``"16:9"``  （桌面播放友好）
- ``duration``     = ``5``        （秒；模型支持 3~15）
- ``sound``        = ``"off"``   （MVP 不需要音轨）

文生 vs 图生
----
同一 model id ``kling-v3``，靠是否传 ``parameters.image`` 自动切换。
图生时 ``image_base64`` 必须是裸 base64（去掉 ``data:image/...;base64,`` 前缀）。

状态归一化
----
ModelVerse 上游 ``task_status`` 字段映射到内部状态：

- ``Pending``  -> ``pending``
- ``Running``  -> ``running``
- ``Success``  -> ``success``（同时附带 ``urls[0]`` 作为 ``video_url``）
- ``Failure``  -> 抛出 ``ModelVerseError``（带上游 ``error_message``）

错误归一化（重要）
----
本客户端**不**吞错。下列三类全部抛出 ``ModelVerseError``：

1. 网络异常（连接失败、超时、解析失败）
2. HTTP 4xx / 5xx
3. 上游 ``task_status == "Failure"``（带 ``error_message``）

这样 T6 编排层的轮询循环能区分"瞬时抖动 / 真失败"——两者的 message
不同，T6 可按需做分支或统一计入。**不要**在本层把网络异常直接转为
``status="failure"`` 返回，否则上层无法区分。

单次 HTTP 超时 30 秒（提交与轮询共用）。

CLI 烟雾测试
----
配好 ``.env`` 后，从 ``backend/`` 目录执行::

    python -m app.services.modelverse "A cinematic shot of a futuristic city"

将提交一次文生任务并每 10 秒轮询一次，直到 ``success`` / ``failure``
或 5 分钟硬超时；终态时输出 ``task_id`` 与终止原因。环境变量缺失时
``app.config`` 会在 import 阶段直接抛错并退出（不会进入轮询）。
"""
from __future__ import annotations

import asyncio
import sys
from typing import Literal, TypedDict

import httpx

from app.config import settings


# --- 接口常量 ---------------------------------------------------------------

BASE_URL = "https://api.modelverse.cn"
SUBMIT_PATH = "/v1/tasks/submit"
STATUS_PATH = "/v1/tasks/status"
MODEL_ID = "kling-v3"

# 单次 HTTP 调用超时（提交 / 轮询共用），匹配 DESIGN 非功能性约束的 30s
HTTP_TIMEOUT_SECONDS: float = 30.0

# --- 默认生成参数（MVP 不暴露给用户） --------------------------------------

DEFAULT_MODE: str = "std"
DEFAULT_ASPECT_RATIO: str = "16:9"
DEFAULT_DURATION: int = 5
DEFAULT_SOUND: str = "off"


# --- 类型 -------------------------------------------------------------------

InternalStatus = Literal["pending", "running", "success", "failure"]


class TaskStatus(TypedDict):
    """归一化的任务状态返回结构。

    - ``status``: 内部状态字符串，见 ``InternalStatus``
    - ``video_url``: 仅 ``status="success"`` 时为非 None 字符串
    - ``error``: 预留字段；本客户端始终为 None（``Failure`` 走异常路径）
    """

    status: InternalStatus
    video_url: str | None
    error: str | None


# --- 异常 -------------------------------------------------------------------

class ModelVerseError(Exception):
    """ModelVerse 客户端层的统一错误类型。

    网络异常、HTTP 4xx/5xx、上游 ``task_status == "Failure"`` 均归一为此异常。
    异常 message 已截断到 200 字符以内、不会 dump 上游 HTML 错误页全文。
    """


# --- 内部工具 ---------------------------------------------------------------

def _auth_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.MODELVERSE_API_KEY}",
        "Content-Type": "application/json",
    }


def _build_submit_body(prompt: str, image_base64: str | None) -> dict:
    params: dict = {
        "mode": DEFAULT_MODE,
        "aspect_ratio": DEFAULT_ASPECT_RATIO,
        "duration": DEFAULT_DURATION,
        "sound": DEFAULT_SOUND,
    }
    if image_base64:
        params["image"] = image_base64
    return {
        "model": MODEL_ID,
        "input": {"prompt": prompt},
        "parameters": params,
    }


def _short(text: str, n: int = 200) -> str:
    """截断响应文本，避免把整段 HTML 错误页拼到异常 message。"""
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1] + "…"


# --- 对外 API ---------------------------------------------------------------

async def submit_kling_task(prompt: str, image_base64: str | None) -> str:
    """提交一次 kling-v3 生成任务，返回 ModelVerse 的 task_id。

    Args:
        prompt: 视频生成文本提示词。
        image_base64: 可选首帧图（裸 base64，无 ``data:`` 前缀）；
            传入则走图生分支，省略则走文生分支。

    Returns:
        ModelVerse 任务 ID（字符串）。

    Raises:
        ModelVerseError: 网络异常 / HTTP 4xx / 5xx / 响应缺少 task_id。
    """
    body = _build_submit_body(prompt, image_base64)
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{BASE_URL}{SUBMIT_PATH}",
                headers=_auth_headers(),
                json=body,
            )
    except httpx.HTTPError as exc:
        raise ModelVerseError(f"submit network error: {exc!s}") from exc

    if resp.status_code >= 400:
        raise ModelVerseError(
            f"submit http {resp.status_code}: {_short(resp.text)}"
        )

    try:
        payload = resp.json()
    except ValueError as exc:
        raise ModelVerseError(
            f"submit response not json: {_short(resp.text)}"
        ) from exc

    task_id = (payload.get("output") or {}).get("task_id")
    if not isinstance(task_id, str) or not task_id:
        raise ModelVerseError(f"submit response missing task_id: {payload!r}")
    return task_id


async def query_kling_task(task_id: str) -> TaskStatus:
    """轮询一次 ModelVerse 任务状态，返回归一化结果。

    Args:
        task_id: ``submit_kling_task`` 返回的 ModelVerse 任务 ID。

    Returns:
        ``TaskStatus``：

        - ``status="pending"``: 任务排队中
        - ``status="running"``: 任务执行中
        - ``status="success"``: 任务完成，``video_url`` 为可直接 GET 的临时 URL

    Raises:
        ModelVerseError: 网络异常 / HTTP 4xx / 5xx / 上游 task_status=="Failure" /
            响应结构异常（如 Success 但没有 urls）。
    """
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.get(
                f"{BASE_URL}{STATUS_PATH}",
                headers=_auth_headers(),
                params={"task_id": task_id},
            )
    except httpx.HTTPError as exc:
        raise ModelVerseError(f"query network error: {exc!s}") from exc

    if resp.status_code >= 400:
        raise ModelVerseError(
            f"query http {resp.status_code}: {_short(resp.text)}"
        )

    try:
        payload = resp.json()
    except ValueError as exc:
        raise ModelVerseError(
            f"query response not json: {_short(resp.text)}"
        ) from exc

    output = payload.get("output") or {}
    upstream_status = output.get("task_status")

    if upstream_status == "Pending":
        return TaskStatus(status="pending", video_url=None, error=None)
    if upstream_status == "Running":
        return TaskStatus(status="running", video_url=None, error=None)
    if upstream_status == "Success":
        urls = output.get("urls") or []
        if not urls or not isinstance(urls[0], str):
            raise ModelVerseError(f"query Success without urls: {payload!r}")
        return TaskStatus(status="success", video_url=urls[0], error=None)
    if upstream_status == "Failure":
        msg = output.get("error_message") or "task failure (no error_message)"
        raise ModelVerseError(f"task failure: {msg}")

    raise ModelVerseError(
        f"query unknown task_status={upstream_status!r}: {payload!r}"
    )


# --- CLI 烟雾入口 -----------------------------------------------------------

# 单次 CLI 烟雾测试的硬上限（与 T6 编排器的 5 分钟轮询窗口一致）
_SMOKE_HARD_TIMEOUT_SECONDS = 300
_SMOKE_POLL_INTERVAL_SECONDS = 10


async def _smoke_test(prompt: str) -> int:
    """CLI 入口的核心循环：提交一次任务并轮询到终态。

    返回 0 表示成功；非 0 表示失败或超时。**不**打印 prompt 全文。
    """
    try:
        task_id = await submit_kling_task(prompt=prompt, image_base64=None)
    except ModelVerseError as exc:
        print(f"[modelverse-smoke] submit failed: {exc}", flush=True)
        return 1
    print(f"[modelverse-smoke] submitted task_id={task_id}", flush=True)

    deadline = asyncio.get_event_loop().time() + _SMOKE_HARD_TIMEOUT_SECONDS
    while True:
        if asyncio.get_event_loop().time() >= deadline:
            print(
                f"[modelverse-smoke] timeout after {_SMOKE_HARD_TIMEOUT_SECONDS}s"
                f" task_id={task_id}",
                flush=True,
            )
            return 1
        await asyncio.sleep(_SMOKE_POLL_INTERVAL_SECONDS)
        try:
            res = await query_kling_task(task_id)
        except ModelVerseError as exc:
            # 任一 ModelVerseError 在 CLI 烟雾测试场景下都视为终止：
            # 真实失败（task Failure）—— 立即结束并打印 message
            # 瞬时网络错误 —— CLI 不做重试，避免无限循环；交由用户重跑
            print(
                f"[modelverse-smoke] terminal: {exc} task_id={task_id}",
                flush=True,
            )
            return 1
        print(
            f"[modelverse-smoke] status={res['status']} task_id={task_id}",
            flush=True,
        )
        if res["status"] == "success":
            print(
                f"[modelverse-smoke] video_url={res['video_url']}",
                flush=True,
            )
            return 0


def _cli_main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: python -m app.services.modelverse <prompt>",
            file=sys.stderr,
        )
        return 2
    prompt = argv[1]
    if not prompt.strip():
        print("error: prompt must not be empty", file=sys.stderr)
        return 2
    return asyncio.run(_smoke_test(prompt))


if __name__ == "__main__":
    raise SystemExit(_cli_main(sys.argv))
