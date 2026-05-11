# frontend/

前端：Vite + React 18 + TypeScript 单页应用。

只在桌面浏览器中运行，负责：
- prompt 输入 + 可选首帧图上传；
- 调后端 `/api/tasks` 提交并 5 秒轮询任务状态；
- 用 IndexedDB 存历史索引（不存视频本体），按需向后端要预签名 URL 播放/下载；
- 历史菜单的增删改与重命名。

不持有任何凭据；UCloud 相关 key 全部留在 backend。

## 当前进度

- T1：目录骨架占位（已完成）
- T8：Vite + React + TS 基建 + 视觉契约 tokens + 占位双栏布局 + `/api` 代理（**本 task 已完成**）
- T9 ～ T12：API client、IndexedDB、主界面与组件、历史菜单（后续 task 落地）

## 技术栈

| 项 | 选型 | 备注 |
|---|---|---|
| 构建工具 | Vite 5 | 锁 React 18 工具链组合 |
| 框架 | React 18.3 + TypeScript 5.6 | 函数组件 + hooks |
| 样式方案 | CSS Modules + 全局 `:root` tokens | tokens 在 `src/index.css` 中 |
| 字体 | IBM Plex Sans / Mono（Google Fonts 引入） | `index.html` 预连接 + 加载 |
| HTTP | 原生 `fetch`（后续 task 用） | 不引第三方 HTTP 客户端 |
| 持久化 | 浏览器 IndexedDB（后续 task 实现） | 仅存历史索引 |

## 目录结构

```
frontend/
├── index.html              # 入口 HTML，预连接 Google Fonts 加载 IBM Plex
├── package.json
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── vite.config.ts          # 含 server.proxy: /api -> http://localhost:8000
├── eslint.config.js
├── public/                 # 静态资源（当前为空，后续 task 按需放）
└── src/
    ├── main.tsx            # React 入口
    ├── App.tsx             # 应用根：占位双栏布局
    ├── App.module.css      # App 局部样式（CSS Modules）
    ├── index.css           # 全局 reset + 设计 tokens（:root CSS variables）
    └── vite-env.d.ts       # Vite + CSS Modules 类型声明
```

## 命令

> 所有命令在 `frontend/` 目录下执行。首次需要先 `npm install`。

```bash
# 安装依赖
npm install

# 启动开发服务器（http://localhost:5173）
npm run dev

# 类型检查 + 生产构建（产物输出到 frontend/dist/）
npm run build

# 本地预览生产构建
npm run preview

# Lint
npm run lint
```

## `/api` 代理

`vite.config.ts` 已配置：

```ts
server: {
  port: 5173,
  strictPort: true,
  proxy: {
    '/api': { target: 'http://localhost:8000', changeOrigin: true },
  },
}
```

前端代码统一用相对路径 `fetch('/api/...')`，开发期由 Vite 转发到 T2 起的 FastAPI 服务。生产部署时由反向代理（或 FastAPI 本身托管静态资源）解决，前端代码无需感知。

## 视觉契约（DESIGN.md 锁定 5 字段）

| 字段 | 本前端的落地 |
|---|---|
| 风格基调 | minimal-refined（克制留白、淡分割线、单一强调色） |
| 明暗主调 | 浅色（背景 `#f7f8fa`，表面 `#ffffff`） |
| 主导色色系 | 冷色系（slate `#0f172a` 文本 + 冷灰 border） |
| accent 用途 | **唯一**冷蓝 `#1d4ed8`，仅用于主 CTA / focus ring / 关键状态指示 |
| 字体倾向 | 无衬线（IBM Plex Sans，中文 fallback PingFang SC / 微软雅黑） |

> 实现层细节（间距阶 4/8/12/16/24/32/48/64、字号阶 12～28、radius 4/8/12、阴影、200ms 标准缓动等）属 task-executor 裁量权范围，定义在 `src/index.css` 的 `:root` 中。后续 task **不要**绕开 tokens 直接写颜色 / 字号字面量。

## 全局设计 tokens

定义于 `src/index.css` 的 `:root`，后续组件直接用 `var(--xxx)` 消费。完整清单：

**颜色**
- 背景：`--color-bg`
- 表面：`--color-surface`、`--color-surface-muted`
- 边框：`--color-border`、`--color-border-strong`
- 文本：`--color-text`、`--color-text-muted`、`--color-text-faint`
- 主强调色：`--color-accent`、`--color-accent-hover`、`--color-accent-soft`、`--color-accent-ring`
- 危险色：`--color-danger`、`--color-danger-soft`

**字体**：`--font-sans`、`--font-mono`

**字号**：`--font-size-xs` ～ `--font-size-2xl`

**间距**：`--space-1` ～ `--space-8`（4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px）

**圆角**：`--radius-sm` / `--radius-md` / `--radius-lg`

**阴影**：`--shadow-sm` / `--shadow-md` / `--shadow-focus`

**Motion**：`--motion-fast`、`--motion-base`、`--easing-standard`

**布局**：`--sidebar-width`

## 占位双栏布局

`App.tsx` 当前渲染两栏占位：

- 左：`<aside>` "历史" 区，固定宽 `--sidebar-width`（280px），由 T11 替换为 `HistoryDrawer`
- 右：`<main>` "主工作区"，由 T10/T12 替换为输入区 + 进度态 + 视频播放器

占位内容仅含标题与一条说明文字，**不预写**未来组件结构。

## 不持有凭据

凭据（ModelVerse API Key、UFile 公私钥等）仅在 backend；前端代码中**禁止**出现任何此类常量或环境变量引用。
