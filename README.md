# 网页版 AI 视频生成平台 MVP

单用户本机自用的网页 AI 视频生成工具。用户在浏览器中输入 prompt（可选附一张首帧参考图），提交后由后端生成视频，成功后在时间倒序的历史菜单中可反复播放、下载、重命名、删除。

仅作为网页在桌面浏览器中使用，不打包为桌面/移动客户端，不做多用户、不做云同步、不做分享。

## 项目目标

- 用最短链路把 UCloud 星图 ModelVerse 的 `kling-v3` 视频生成能力接起来。
- 前端单页应用 + 后端 FastAPI 薄代理两份代码，单机运行。
- 历史仅存本浏览器（IndexedDB 索引 + UFile 对象存储视频本体）。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端构建 | Vite |
| 前端框架 | React 18 + TypeScript |
| 前端持久化 | 浏览器 IndexedDB（仅存历史索引） |
| 后端语言 | Python 3.11+ |
| 后端框架 | FastAPI |
| 后端任务 | FastAPI BackgroundTasks + asyncio |
| 后端持久化 | SQLite（单文件 `tasks.db`） |
| 后端 HTTP 客户端 | httpx（异步） |
| 对象存储 SDK | UCloud 官方 `ufile` Python SDK |
| 视频模型 | UCloud 星图 ModelVerse `kling-v3` |
| 对象存储 | UCloud UFile（US3） |

## 目录结构

```
.
├── backend/            # Python FastAPI 后端（由后续 task 填充）
├── frontend/           # React + Vite 前端（由后续 task 填充）
├── .env.example        # 环境变量模板
├── .gitignore
└── README.md
```

## 所需环境变量

后端启动前需要把以下变量写入 `.env`（可复制 `.env.example` 改名）：

| 变量名 | 说明 |
|---|---|
| `MODELVERSE_API_KEY` | UCloud 星图 ModelVerse 的 API Key，用于调用 kling-v3 视频生成接口 |
| `UFILE_PUBLIC_KEY` | UCloud UFile 公钥 |
| `UFILE_PRIVATE_KEY` | UCloud UFile 私钥 |
| `UFILE_BUCKET` | UFile 存储空间名（需在 UCloud 控制台手动创建） |
| `UFILE_REGION` | UFile bucket 所在 region（如 `cn-bj`） |

凭据仅保留在后端环境，前端代码不得出现。

## 启动方式

> 具体启动命令由 T13 补齐。本 task 仅建骨架。

预期形态（占位）：
- 后端：进入 `backend/`，用 `uvicorn` 起 FastAPI 进程
- 前端：进入 `frontend/`，用 `vite` 起开发服务器（默认 `http://localhost:5173`）

## 相关文档

- 需求：`.cadence/cycle-video-gen-mvp/REQUIREMENT.md`
- 技术设计：`.cadence/cycle-video-gen-mvp/DESIGN.md`
