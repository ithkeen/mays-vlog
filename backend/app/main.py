"""FastAPI 应用入口。

本模块只搭骨架：
- 触发启动期配置校验（``app.config`` 在导入时实例化 ``Settings``）
- 应用启动期初始化 SQLite（建表 + 孤儿清理），并打日志
- 配置 CORS（开发期允许 ``http://localhost:5173``）
- 配置请求体上限（16 MiB，覆盖前端 10MB 图 base64 膨胀后约 13.3MB + JSON 开销）
- 暴露 ``GET /healthz``

业务路由（``/api/tasks`` 等）由后续 task 在 ``app.api`` 下挂载。
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# 触发启动期配置校验：缺失环境变量会立即抛出 RuntimeError
from app.config import settings  # noqa: F401
from app.api.tasks import router as tasks_router
from app.storage import db as storage_db

logger = logging.getLogger("app.startup")
if not logger.handlers:
    # 兜底配置：uvicorn 一般已经初始化了 root logger，这里只在裸跑时生效
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

# 请求体上限：16 MiB（16 * 1024 * 1024 bytes），≥ 任务要求的 15MB
MAX_BODY_SIZE = 16 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动 / 关闭钩子。

    启动期：
    1. 建表（IF NOT EXISTS）
    2. 把 ``status IN ('pending','running')`` 的旧行扫成 ``failure``
       （进程崩溃 / 重启后的孤儿清理；数量可以为 0）
    3. 日志输出 db 路径、建表完成、孤儿清理数量

    关闭期：无特殊清理（每次仓储调用都用独立短连接）。
    """
    db_path = storage_db.resolve_db_path()
    storage_db.init_db()
    logger.info("tasks 表已就绪（db=%s）", db_path)
    orphan_count = storage_db.mark_orphans_failed()
    logger.info(
        "启动孤儿清理：已将 %d 条 pending/running 旧任务置为 failure",
        orphan_count,
    )
    yield


app = FastAPI(title="Video Gen MVP Backend", lifespan=lifespan)

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


# 业务路由：``/api/tasks`` 系列 6 个端点（T7）
app.include_router(tasks_router, prefix="/api")
