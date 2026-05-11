# backend/

后端：Python 3.11+ / FastAPI。

承担三件不能放前端的事：
1. 持有 `MODELVERSE_API_KEY` 与 UFile 公私钥；
2. 异步轮询 ModelVerse 视频任务（1～5 分钟）；
3. 把成功视频从 ModelVerse 临时 URL 转存到 UCloud UFile，按需签发可播放的私有 URL 给前端。

> 本目录骨架由 T1 创建；具体代码（FastAPI 入口、路由、services、storage 等）由后续 task 填充。详见 `.cadence/cycle-video-gen-mvp/DESIGN.md` 「模块划分 - 后端」。
