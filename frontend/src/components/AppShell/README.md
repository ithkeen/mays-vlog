# components/AppShell/

应用外壳。职责：两列 grid 布局（左 Sidebar + 右主区）+ 常驻渲染三个一级 page + 根据 URL 切换可见性。

## 对外接口

单一导出 `<AppShell />`，无 props。使用前需被 `<BrowserRouter>`（或等价 router）包裹（见 `src/App.tsx`）。

## 文件清单

| 文件 | 职责 |
|---|---|
| `AppShell.tsx` | 外壳主体。内部：`<Sidebar/>` + `<main>`；主区内常驻三个 page wrapper 并按一级路径切可见性；`<Routes>` 负责 `/` 与 `*` 重定向以及 `/history/:id` 详情页挂载 |
| `AppShell.module.css` | 两列 grid、非活动 wrapper 的 pointer-events |
| `Sidebar.tsx` | 占位窄态侧栏：三个 `NavLink`（Generate / History / Characters）；完整视觉样式由后续 task 实现 |
| `Sidebar.module.css` | Sidebar 占位样式 |
| `PageHeader.tsx` | 主区顶部 header：左侧 `title` 槽位 + 右侧当前留空 |
| `PageHeader.module.css` | Header 样式 |

## keep-mounted 约定

- Generate / History（列表） / Characters（列表）三个 page **常驻挂载**：其 wrapper 始终在 DOM 里，非活动态用 `display:none + aria-hidden + tabIndex=-1 + pointer-events:none`。
- `HistoryDetailPage`（`/history/:id`）**不** keep-mounted：作为 `<Route>` element 正常 mount/unmount。
- `/characters/new` 与 `/characters` 共享同一 `CharactersPage`，由 pathname 驱动内部态切换（本 task 仅占位）。

## 路由兜底

- 未知 path → 重定向 `/generate`
- `/` → 重定向 `/generate`
- 刷新任一合法 URL 保持在当前页（不回跳 Generate）

## 设计边界

- Sidebar 目前只跑通路由高亮（`NavLink` 自带 `aria-current="page"`），不做 logo / icon / 宽度收束；这些由本 cycle 的 T2 task 交付。
- PageHeader 右侧槽位保留为空 div，后续 task 如需面包屑、操作按钮可由各 page 在 header 上方或下方自行渲染；本组件不做 slot prop（等真正有第二处使用再抽）。
