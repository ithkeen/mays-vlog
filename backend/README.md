# backend/

后端：Python 3.11+ / FastAPI 薄代理。

承担三件不能放前端的事：
1. 持有 `MODELVERSE_API_KEY` 与 UFile 公私钥；
2. 异步轮询 ModelVerse 视频任务（1～5 分钟）；
3. 把成功视频从 ModelVerse 临时 URL 转存到 UCloud UFile，按需签发可播放的私有 URL 给前端。

## 目录结构

```
backend/
├── README.md           # 本文档
├── pyproject.toml      # 依赖与项目元数据
└── app/
    ├── __init__.py
    ├── main.py         # FastAPI 入口：CORS、请求体上限、/healthz
    ├── config.py       # pydantic-settings 读 .env，启动期校验必填字段
    ├── api/            # 业务路由（T5/T6 填充）
    ├── services/       # ModelVerse / UFile / 编排器 / 串行锁（T3/T4/T6 填充）
    └── storage/        # SQLite 初始化与 tasks 表 CRUD（T3 填充）
```

## 依赖安装

依赖在 `pyproject.toml` 中声明，至少包含：`fastapi`、`uvicorn[standard]`、
`pydantic`、`pydantic-settings`、`httpx`、`ufile`、`requests`。

推荐使用项目根 `.venv`（已由 uv 创建）：

```bash
# 在项目根目录执行
uv pip install -e backend/
```

或使用 pip：

```bash
source .venv/bin/activate
pip install -e backend/
```

## 环境变量

后端启动前需要把以下变量写入项目根 `.env`（可复制项目根 `.env.example` 改名）：

| 变量名 | 说明 |
|---|---|
| `MODELVERSE_API_KEY` | UCloud 星图 ModelVerse 的 API Key |
| `UFILE_PUBLIC_KEY` | UCloud UFile 公钥 |
| `UFILE_PRIVATE_KEY` | UCloud UFile 私钥 |
| `UFILE_BUCKET` | UFile 存储空间名（需在 UCloud 控制台手动创建） |
| `UFILE_REGION` | UFile bucket 所在 region（如 `cn-bj`） |

任一缺失，uvicorn 启动会立即抛 `RuntimeError` 并列出缺失变量名。
`.env` 路径锚定在项目根目录（由 `app/config.py` 用 `__file__` 推算），
所以在 `backend/` 或项目根任一目录执行 uvicorn 都能读到。

## 启动命令

```bash
cd backend
uvicorn app.main:app --reload
```

默认监听 `http://127.0.0.1:8000`。

健康检查：

```bash
curl http://127.0.0.1:8000/healthz
# {"status":"ok"}
```

## 请求体上限

中间件 `limit_body_size` 按 `Content-Length` 拒绝超过 **16 MiB** 的请求体，
覆盖 10MB 首帧图 base64 膨胀后（≈ 13.3MB）+ JSON 开销。超限返回 `413`：

```json
{"error": "request_entity_too_large", "max_bytes": 16777216}
```

## CORS

开发期 `CORSMiddleware` 仅允许前端来源 `http://localhost:5173`，允许凭据、
所有方法、所有请求头。

## 后续任务衔接

- T3：在 `app/storage/db.py` 落 SQLite 初始化与 `tasks` 表 CRUD
- T4：在 `app/services/modelverse.py` 与 `app/services/ufile.py` 落 SDK 封装
- T5：在 `app/api/tasks.py` 落 `/api/tasks` 系列路由并挂载到 `main.py`
- T6：在 `app/services/orchestrator.py` 与 `app/services/lock.py` 落后台编排与串行锁

每个后续 task 完成时，会回到本 README 更新对应章节。
