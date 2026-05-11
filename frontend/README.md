# frontend/

前端：Vite + React 18 + TypeScript 单页应用。

只在桌面浏览器中运行，负责：
- prompt 输入 + 可选首帧图上传；
- 调后端 `/api/tasks` 提交并 5 秒轮询任务状态；
- 用 IndexedDB 存历史索引（不存视频本体），按需向后端要预签名 URL 播放/下载；
- 历史菜单的增删改与重命名。

不持有任何凭据；UCloud 相关 key 全部留在 backend。

> 本目录骨架由 T1 创建；具体代码（App、components、lib 等）由后续 task 填充。详见 `.cadence/cycle-video-gen-mvp/DESIGN.md` 「模块划分 - 前端」。
