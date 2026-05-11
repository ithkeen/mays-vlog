"""FastAPI 应用入口。

本模块只搭骨架：
- 触发启动期配置校验（``app.config`` 在导入时实例化 ``Settings``）
- 配置 CORS（开发期允许 ``http://localhost:5173``）
- 配置请求体上限（16 MiB，覆盖前端 10MB 图 base64 膨胀后约 13.3MB + JSON 开销）
- 暴露 ``GET /healthz``

业务路由（``/api/tasks`` 等）由后续 task 在 ``app.api`` 下挂载。
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# 触发启动期配置校验：缺失环境变量会立即抛出 RuntimeError
from app.config import settings  # noqa: F401

# 请求体上限：16 MiB（16 * 1024 * 1024 bytes），≥ 任务要求的 15MB
MAX_BODY_SIZE = 16 * 1024 * 1024

app = FastAPI(title="Video Gen MVP Backend")

# 开发期允许前端 Vite 默认端口
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    """按 Content-Length 头拒绝超过 ``MAX_BODY_SIZE`` 的请求。

    浏览器 ``fetch`` + JSON 提交都会带 Content-Length，对项目的图生
    上传链路（最大 ~13.3MB base64）足够。无 Content-Length 的请求
    （如 chunked transfer）直接放行——MVP 不暴露此类入口。
    """
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            length = int(content_length)
        except ValueError:
            length = None
        if length is not None and length > MAX_BODY_SIZE:
            return JSONResponse(
                status_code=413,
                content={
                    "error": "request_entity_too_large",
                    "max_bytes": MAX_BODY_SIZE,
                },
            )
    return await call_next(request)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
