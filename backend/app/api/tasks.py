"""HTTP API 路由：``/api/tasks`` 系列 6 个端点。

把 T6 编排器（``app.services.orchestrator``）与 T3 持久层（``app.storage.db``）
封装成对前端友好的 JSON HTTP 接口。所有端点：

- ``POST   /api/tasks``           提交新任务（抢锁 + 立即返回 pending）
- ``GET    /api/tasks``           历史列表（仅 success，按 finished_at DESC）
- ``GET    /api/tasks/{id}``      单条任务详情（任意状态）
- ``GET    /api/tasks/{id}/play_url``  签发 1 小时预签名 URL（仅 success）
- ``PATCH  /api/tasks/{id}``      重命名 title
- ``DELETE /api/tasks/{id}``      删除任务（行 + 视频对象）

### 错误响应约定（与 DESIGN「接口设计」一致）

- 业务错误统一 ``{"error": "<code>"}`` JSON 体（必要时附附加字段，例如
  409 的 ``current_task_id``）
- pydantic 字段校验失败 → FastAPI 默认 422 响应体（``{"detail": [...]}``），
  保留默认体不改写——单纯字段级错误前端按 422 处理即可
- 图片 base64 解码失败由路由层手动检查 → 400 ``{"error": "image_decode_failed"}``
- 业务上的异常 → 通过 ``ConcurrentTaskError`` / ``TaskNotPlayableError`` /
  ``UFileError`` 映射到对应 HTTP 状态码

### `has_image` 字段序列化

DB 层 ``has_image`` 存 INTEGER (0/1)，接口层统一序列化为 ``bool``。
两个工具函数 ``_row_to_history`` / ``_row_to_detail`` 负责这步转换，
并裁剪出对应端点需要的字段子集。
"""
from __future__ import annotations

import base64
import binascii
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app.services import ufile as ufile_service
from app.services.orchestrator import (
    ConcurrentTaskError,
    TaskNotPlayableError,
    get_play_url_for_task,
    submit_task,
)
from app.storage import db

logger = logging.getLogger("app.api.tasks")

router = APIRouter(prefix="/tasks", tags=["tasks"])


# --- 请求 / 响应模型 -------------------------------------------------------


class SubmitTaskRequest(BaseModel):
    """POST /api/tasks 请求体。

    ``image`` 是 raw base64 字符串（**不带** ``data:image/...;base64,`` 前缀）；
    ``None`` 表示文生视频。``prompt`` 受 ``min_length=1 / max_length=2500`` 约束，
    超出会触发 FastAPI 默认 422 校验错误。
    """

    prompt: str = Field(min_length=1, max_length=2500)
    image: str | None = None


class SubmitTaskResponse(BaseModel):
    id: str
    status: str


class HistoryItemResponse(BaseModel):
    id: str
    prompt: str
    title: str | None = None
    has_image: bool
    created_at: int
    finished_at: int


class TaskDetailResponse(BaseModel):
    id: str
    status: str
    prompt: str
    has_image: bool
    title: str | None = None
    created_at: int
    finished_at: int | None = None
    error_message: str | None = None


class PlayUrlResponse(BaseModel):
    url: str
    expires_in: int


class RenameRequest(BaseModel):
    title: str


class RenameResponse(BaseModel):
    id: str
    title: str


# --- 工具函数 --------------------------------------------------------------


def _err(status_code: int, error: str, **extra: Any) -> JSONResponse:
    """构造统一错误响应 ``{"error": "<code>", **extra}``。

    返回 ``JSONResponse`` 会绕过 ``response_model`` 校验，所以错误响应
    的 body 形状与端点声明的成功响应模型可以不一致。
    """
    body: dict[str, Any] = {"error": error}
    body.update(extra)
    return JSONResponse(status_code=status_code, content=body)


def _row_to_history(row: dict) -> dict:
    """裁出 GET /api/tasks 列表项的 6 个字段（has_image 转 bool）。"""
    return {
        "id": row["id"],
        "prompt": row["prompt"],
        "title": row["title"],
        "has_image": bool(row["has_image"]),
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
    }


def _row_to_detail(row: dict) -> dict:
    """裁出 GET /api/tasks/{id} 详情的 8 个字段（has_image 转 bool）。"""
    return {
        "id": row["id"],
        "status": row["status"],
        "prompt": row["prompt"],
        "has_image": bool(row["has_image"]),
        "title": row["title"],
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
        "error_message": row["error_message"],
    }


# --- 端点 ------------------------------------------------------------------


@router.post("", response_model=SubmitTaskResponse)
async def submit(
    req: SubmitTaskRequest, background_tasks: BackgroundTasks
) -> Any:
    """提交一个新任务。

    流程：
    1. 若 ``image`` 非空，用 ``base64.b64decode(..., validate=True)`` 做一次
       解码校验；非 base64 字符（含 ``data:`` 前缀）会被拒为 400
    2. 调 ``orchestrator.submit_task`` 抢锁 + 入库 ``pending`` + 调度后台任务
    3. 并发冲突 → 409 ``{"error":"task_in_progress","current_task_id":...}``
    4. 成功 → 200 ``{"id":..., "status":"pending"}``

    注意：``submit_task`` 返回 dict 含三个字段 ``id / status / current_task_id``，
    这里只透传前两个；``current_task_id`` 仅在 409 路径下返回给前端。
    """
    if req.image is not None:
        try:
            # ``validate=True`` 拒绝非 base64 字符（包括换行 / data: 前缀）。
            # 注意空字符串解码会成功并返回 b""，不视为解码失败——交由
            # 上游 ModelVerse 自行判定该输入是否合规。
            base64.b64decode(req.image, validate=True)
        except (binascii.Error, ValueError):
            return _err(400, "image_decode_failed")

    try:
        result = await submit_task(req.prompt, req.image, background_tasks)
    except ConcurrentTaskError as exc:
        return _err(
            409,
            "task_in_progress",
            current_task_id=exc.current_task_id,
        )

    return {"id": result["id"], "status": result["status"]}


@router.get("", response_model=list[HistoryItemResponse])
async def list_history() -> list[dict]:
    """历史列表：仅 ``success``，按 ``finished_at DESC``。"""
    rows = db.list_success_tasks()
    return [_row_to_history(r) for r in rows]


@router.get("/{task_id}", response_model=TaskDetailResponse)
async def get_detail(task_id: str) -> Any:
    """单条任务详情；不存在返回 404。"""
    row = db.get_task(task_id)
    if row is None:
        return _err(404, "task_not_found")
    return _row_to_detail(row)


@router.get("/{task_id}/play_url", response_model=PlayUrlResponse)
async def play_url(task_id: str) -> Any:
    """签发 1 小时预签名 GET URL；仅 ``status='success'`` 时返回 200。

    不存在 / 非 success 一律 404 ``{"error":"task_not_playable"}``。
    （编排器层的 ``TaskNotPlayableError`` 覆盖两种情况）
    """
    try:
        url = get_play_url_for_task(task_id)
    except TaskNotPlayableError:
        return _err(404, "task_not_playable")
    return {"url": url, "expires_in": 3600}


@router.patch("/{task_id}", response_model=RenameResponse)
async def rename(task_id: str, req: RenameRequest) -> Any:
    """重命名任务标题；不存在返回 404。"""
    row = db.get_task(task_id)
    if row is None:
        return _err(404, "task_not_found")
    db.update_task_title(task_id, req.title)
    return {"id": task_id, "title": req.title}


@router.delete("/{task_id}", status_code=204)
async def delete(task_id: str) -> Response:
    """删除任务行 + 关联 UFile 视频对象。

    顺序：
    1. ``get_task`` 拿到 ``ufile_object_key``（如有）；行不存在 → 404
    2. ``delete_task`` 删 SQLite 行
    3. 若有 ``ufile_object_key``，调 ``ufile.delete_object`` 清理对象

    ``UFileError`` 容错策略：行已被删除（步骤 2），用户视角的"删除"已生效；
    UFile 对象残留视为可后续手动清理的孤儿——所以这里 log warning 后仍
    返回 204，不把底层存储错误冒泡给前端。
    """
    row = db.get_task(task_id)
    if row is None:
        return _err(404, "task_not_found")

    object_key = row.get("ufile_object_key")
    db.delete_task(task_id)

    if object_key:
        try:
            ufile_service.delete_object(object_key)
        except ufile_service.UFileError as exc:
            logger.warning(
                "UFile delete failed for task_id=%s object_key=%s: %s",
                task_id,
                object_key,
                exc,
            )
    return Response(status_code=204)
