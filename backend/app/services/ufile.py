"""UFile（UCloud US3）客户端封装。

只暴露项目编排器（T6）会用到的三件事：

- ``upload_video_from_url(source_url, object_key)``：从 ModelVerse 临时
  下载 URL 流式拉取并直传到配置好的 UFile bucket
- ``get_play_url(object_key, expires_seconds=3600)``：签发私有 bucket 的
  预签名播放/下载 URL（可直接喂给 ``<video src>``）
- ``delete_object(object_key)``：删除 UFile 对象（任务删除时清理用）

所有失败统一抛 :class:`UFileError`。模块加载时一次性 ``config.set_default``
（含 region 域名后缀、HTTPS、连接超时、默认过期时间），并构造单例
``filemanager.FileManager``。

关于 SDK 的两个关键 gotcha（在实现时必须显式处理）：

1. ``putstream`` 的 ``Content-Type`` HTTP 头由 ``mime_type`` 参数决定——
   传 ``header={"Content-Type": ...}`` 会被 SDK 内部 ``header['Content-Type']
   = mime_type`` 覆写为 ``application/octet-stream``（mime_type 默认值），
   所以必须显式传 ``mime_type="video/mp4"``。
2. ``config.set_default(...)`` 是全局可变状态；且 ``open_ssl`` 形参默认
   ``False``（而非 ``None``）会在每次调用被无条件写回——本项目要求 HTTPS
   时，每次 ``set_default`` 都得显式带 ``open_ssl=True``。该函数还会被本
   模块在 ``get_play_url`` 中按需修改 ``expires``，因此用模块级
   ``threading.Lock`` 串行化 set_default → private_download_url 序列。
"""
from __future__ import annotations

import threading
import time

import requests
from ufile import config, filemanager

from app.config import settings

# 默认预签名 URL 过期时间（秒）。对齐 DESIGN「关键流程」段中"按需签发 1 小时"
_DEFAULT_EXPIRES_SECONDS = 3600

# UFile region 域名后缀，例如 cn-bj 时为 ".cn-bj.ufileos.com"
_REGION_SUFFIX = f".{settings.UFILE_REGION}.ufileos.com"

# 单次 HTTP 请求超时（秒），同时作为 requests.get(stream) 与 SDK 内部 putstream
# 的连接超时。覆盖 5～50MB mp4 + 国内带宽下行的合理上限。
_HTTP_TIMEOUT_SECONDS = 300

# 失败重试间隔（秒）。spec 要求 1～2s 即可
_RETRY_BACKOFF_SECONDS = 1


class UFileError(Exception):
    """UFile 操作失败的统一异常。

    message 形如 ``"UFile <operation> failed for object_key=...: <detail>"``，
    便于上层 logger 与编排器日志直接打印。属性 ``operation`` / ``object_key``
    / ``detail`` 单独保留，方便上层结构化处理（虽然 MVP 暂未用到）。
    """

    def __init__(self, operation: str, object_key: str, detail: str) -> None:
        self.operation = operation
        self.object_key = object_key
        self.detail = detail
        super().__init__(
            f"UFile {operation} failed for object_key={object_key!r}: {detail}"
        )


# 模块导入期一次性配好 SDK 全局默认。后续 get_play_url 会临时改 expires，
# 那条路径用 _config_lock 串行化。
config.set_default(
    uploadsuffix=_REGION_SUFFIX,
    downloadsuffix=_REGION_SUFFIX,
    connection_timeout=_HTTP_TIMEOUT_SECONDS,
    expires=_DEFAULT_EXPIRES_SECONDS,
    open_ssl=True,
)

_handler = filemanager.FileManager(
    settings.UFILE_PUBLIC_KEY, settings.UFILE_PRIVATE_KEY
)

# 保护 ``config.set_default`` → ``private_download_url`` 序列。FastAPI 单事件
# 循环在 BackgroundTasks / 同步路由中都可能并发触达本模块，加锁是必要的。
_config_lock = threading.Lock()


def upload_video_from_url(source_url: str, object_key: str) -> None:
    """从 ``source_url`` 流式拉取视频并 putstream 上传到 UFile bucket。

    - ``requests.get(stream=True, timeout=300)`` 拉视频
    - SDK ``putstream`` 上传，``mime_type='video/mp4'`` 让 ``Content-Type`` HTTP
      头落地为 ``video/mp4``（满足前端 ``<video>`` 直接播放需要）
    - ``requests.RequestException`` 与 UFile SDK 异常（含返回 ResponseInfo
      非 ok 的"软失败"）会自动重试 1 次（间隔 1s）
    - 仍失败抛 :class:`UFileError`
    """
    last_detail: str | None = None
    for attempt in (1, 2):
        try:
            with requests.get(
                source_url, stream=True, timeout=_HTTP_TIMEOUT_SECONDS
            ) as resp:
                resp.raise_for_status()
                # 关键：mime_type 才是真正决定 HTTP Content-Type 头的入参；
                # 传 header={'Content-Type': ...} 会被 SDK 内部覆写为
                # 'application/octet-stream'（mime_type 默认值）
                _, info = _handler.putstream(
                    settings.UFILE_BUCKET,
                    object_key,
                    resp.raw,
                    mime_type="video/mp4",
                )
            if info.ok():
                return
            last_detail = (
                f"upload status_code={info.status_code} "
                f"error={info.error or 'unknown'}"
            )
        except requests.RequestException as e:
            last_detail = f"requests.RequestException: {e}"
        except Exception as e:
            # UFile SDK 内部多数错误已经走 ResponseInfo 通路（不抛），但鉴权
            # 失败、参数构造异常等仍可能直接抛——一并归一化为 UFileError。
            last_detail = f"{type(e).__name__}: {e}"

        if attempt == 1:
            time.sleep(_RETRY_BACKOFF_SECONDS)

    raise UFileError("upload", object_key, last_detail or "unknown error")


def get_play_url(
    object_key: str, expires_seconds: int = _DEFAULT_EXPIRES_SECONDS
) -> str:
    """返回 UFile 私有 bucket 对象 ``object_key`` 的预签名 GET URL。

    内部用模块级 ``threading.Lock`` 包住 ``config.set_default(expires=...)``
    与 ``private_download_url`` 调用。``open_ssl=True`` 必须每次重传，否则
    SDK 会把它默认重置为 False。
    """
    try:
        with _config_lock:
            config.set_default(
                expires=expires_seconds,
                open_ssl=True,
            )
            return _handler.private_download_url(
                settings.UFILE_BUCKET, object_key
            )
    except Exception as e:
        raise UFileError(
            "get_play_url", object_key, f"{type(e).__name__}: {e}"
        ) from e


def delete_object(object_key: str) -> None:
    """从 UFile bucket 删除 ``object_key`` 对应对象。

    对象不存在（HTTP 404）不视为错误，直接 return。其它失败抛
    :class:`UFileError`。
    """
    try:
        _, info = _handler.deletefile(settings.UFILE_BUCKET, object_key)
    except Exception as e:
        raise UFileError(
            "delete", object_key, f"{type(e).__name__}: {e}"
        ) from e

    if info.ok():
        return
    if info.status_code == 404:
        # 对象本来就不存在，删除幂等地视为成功
        return
    raise UFileError(
        "delete",
        object_key,
        f"status_code={info.status_code} error={info.error or 'unknown'}",
    )
