"""应用配置：从环境变量 / 项目根目录 .env 读取必填凭据。

模块加载时即实例化 ``settings``。如果缺少任何必填字段，会抛出
``RuntimeError`` 并明确列出缺失变量名，让 uvicorn 启动直接失败，
而不是带着空字符串静默启动。
"""
from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> backend/app -> backend -> 项目根
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
ENV_FILE = PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    """运行时配置。所有字段均为必填，缺失时启动失败。"""

    MODELVERSE_API_KEY: str
    UFILE_PUBLIC_KEY: str
    UFILE_PRIVATE_KEY: str
    UFILE_BUCKET: str
    UFILE_REGION: str

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


def _load_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        missing = [
            str(err["loc"][0])
            for err in exc.errors()
            if err.get("type") == "missing"
        ]
        if missing:
            raise RuntimeError(
                "缺少必要的环境变量: "
                + ", ".join(missing)
                + f"。请在 {ENV_FILE} 中补齐（可参考项目根 .env.example）。"
            ) from exc
        raise


settings = _load_settings()
