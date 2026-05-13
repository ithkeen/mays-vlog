# 前端布局重构：sidebar 多入口 + 主区整页切换

本次纯前端重构：引入 `react-router-dom` 做三页整页切换（`/generate` / `/history` / `/characters` 及两个子路径），用一个 `AppShell` 组件承载常驻窄态 sidebar 与主区 outlet。三个一级页面 Generate / History / Characters **全部 keep-mounted**，用 CSS `display` 切换可见性，以此保住 Generate 页跨页切换时的任务进度与轮询 hook（与需求验收 104 条"切回 Generate 能继续看进度"直接对应）。HistoryDrawer / CharacterDrawer / `openDrawer` 抽屉互斥状态机整体删除；它们原有的列表 / 详情 / 创建表单等内部组件拆出、平提到 `pages/` 与 `components/character/` 下复用。History 卡片的"视频首帧满铺"靠前端 `<video preload="metadata">` + `play_url` 实时预签 + 6 路并发限流取，不动后端、不动 IDB schema。

## 技术栈

- 沿用 PROJECT.md 的 React 18.3 + TypeScript + Vite 5 + CSS Modules + 现有 :root tokens
- 新增：`react-router-dom` v6（整页切换 + 路径参数）
- 前端测试框架：**本 cycle 不引入**（纯 UI 重构，内部逻辑不动；后续 cycle 如需测试再单独决策落 PROJECT.md）
- 运行 / 构建命令沿用现状：`npm run dev` / `npm run build`

## 模块划分

### 新增

- `frontend/src/App.tsx`（修改）：根节点接入 `BrowserRouter`，渲染 `AppShell`
- `frontend/src/components/AppShell/AppShell.tsx` [新增]：整体外壳 = sidebar + main outlet 两列 grid；内部 **常驻** 渲染三个 page 组件并用 `display: none / block` 根据当前 route 控制可见性
- `frontend/src/components/AppShell/Sidebar.tsx` [新增]：窄态 sidebar（64–80px），顶部 logo + 三个一级入口（icon + label 竖堆），选中态（图标/文字加深 + 左侧 2px 冷蓝竖线）；nav 用 `NavLink`
- `frontend/src/components/AppShell/PageHeader.tsx` [新增]：主区顶部 header，左侧标题文案由各 page 传入，右侧留空
- `frontend/src/pages/GeneratePage.tsx` [新增]：包装现有 `SubmissionWorkspace`（组件本身不动），外层套 `PageHeader title="Generate"`
- `frontend/src/pages/HistoryPage.tsx` [新增]：`PageHeader title="History"` + grid 列表（`auto-fill minmax(280px, 1fr)`），使用现有 `useHistoryList`（从 IDB `historyDb` 同源）；卡片 = `HistoryCard`
- `frontend/src/pages/HistoryDetailPage.tsx` [新增]：独立详情页；由 `useParams().id` 取任务，渲染复用自原 `HistoryDetail` 视觉骨架（大播放器 + prompt / 元数据 / 下载）；顶部 `PageHeader` 标题 `History` 前加返回按钮（或面包屑 `History / <title>`），点击 `navigate('/history')`
- `frontend/src/pages/CharactersPage.tsx` [新增]：`PageHeader title="Characters"` + grid；首位永远占位卡，后面是真实角色卡；内部 `useRouteMatch` 判断 `/characters/new` 时在右侧主区域下方渲染 `CharacterCreateForm` 面板（沿用现抽屉两态切换的心智，UI 位置改为主区内嵌）
- `frontend/src/components/character/CharacterCard.tsx` [沿用 + 改造]：从 `components/CharacterDrawer/` 平提出来；原有"内联展开 + 删除二次确认"保留；样式改造为"满铺参考图 + 底部渐变叠层 + Name"的 grid 卡；**展开动作为原位纵向抽高**（展开态改变自身 `grid-row: span 2` 或自身高度 auto，不打断同行其他卡、不遮盖下方）
- `frontend/src/components/character/NewCharacterCard.tsx` [沿用 + 改造]：点击 → `navigate('/characters/new')`，不再通过 `openDrawer` 开表单
- `frontend/src/components/character/CharacterCreateForm.tsx` [沿用]：表单字段与提交/取消逻辑保持；提交成功或取消后 `navigate('/characters')`
- `frontend/src/components/history/HistoryCard.tsx` [新增]：满铺首帧（`<video preload="metadata" muted playsInline>`，拿到 metadata 后 `currentTime = 0.1` 取帧）+ 底部渐变叠层 + `title` + `finishedAt` 相对时间；点击 → `navigate('/history/{id}')`
- `frontend/src/components/history/HistoryDetail.tsx` [沿用 + 改造]：从原 `HistoryDrawer` 内部抽出，成为独立组件，供 `HistoryDetailPage` 消费
- `frontend/src/hooks/usePlayUrlPool.ts` [新增]：批量 `play_url` 获取的并发池（见"关键流程"）

### 删除

- `frontend/src/components/HistoryDrawer/` 整个目录
- `frontend/src/components/CharacterDrawer/` 整个目录（其下子组件先迁移到 `components/character/` 再删）
- 主界面（原 App / 外层容器）里的 `openDrawer: 'none' | 'history' | 'characters'` 状态与互斥逻辑
- 主界面 header 上原抽屉触发按钮（Generate 页不再有独立 header 按钮）

### 模块文字树

```
frontend/src/
├── App.tsx                          [改] BrowserRouter 入口
├── components/
│   ├── AppShell/                    [新]
│   │   ├── AppShell.tsx             [新] 两列 grid + keep-mounted 三页
│   │   ├── Sidebar.tsx              [新]
│   │   └── PageHeader.tsx           [新]
│   ├── SubmissionWorkspace/...      [沿用，内部不动]
│   ├── character/                   [新目录；从 CharacterDrawer 平提]
│   │   ├── CharacterCard.tsx        [改造样式 + 展开为 span 2]
│   │   ├── NewCharacterCard.tsx     [改为 navigate]
│   │   └── CharacterCreateForm.tsx  [沿用]
│   └── history/                     [新目录]
│       ├── HistoryCard.tsx          [新]
│       └── HistoryDetail.tsx        [从 HistoryDrawer 抽出]
├── pages/                           [新目录]
│   ├── GeneratePage.tsx             [新]
│   ├── HistoryPage.tsx              [新]
│   ├── HistoryDetailPage.tsx        [新]
│   └── CharactersPage.tsx           [新]
├── hooks/
│   └── usePlayUrlPool.ts            [新]
├── api/                             [沿用]
└── storage/                         [沿用]
```

## 数据模型

**不新增字段、不改 IDB schema、不动 `DB_VERSION`。** 复用现有 `historyDb`（`history` store 的 `id / prompt / hasImage / title / createdAt / finishedAt`）与 `charactersDb`（参考图 Blob + `name` + `nameKey` + `instructions` + `createdAt`）。

## 接口设计

### 路由表（`react-router-dom` v6）

| path | page | 说明 |
|---|---|---|
| `/` | — | redirect → `/generate` |
| `/generate` | GeneratePage | 默认入口 |
| `/history` | HistoryPage | grid 列表 |
| `/history/:id` | HistoryDetailPage | 独立详情页 |
| `/characters` | CharactersPage | grid 列表 |
| `/characters/new` | CharactersPage | 同一 page，内部 state 切到创建表单态 |
| `*` | — | 兜底 redirect → `/generate` |

`/characters` 与 `/characters/new` **刻意共用同一 page 组件**：与需求"点占位卡主区切换为创建表单态"语义一致，grid 与表单共存于 CharactersPage，由当前 pathname 决定是否渲染表单面板。

### keep-mounted 可见性 API

`AppShell` 内部伪代码级约定（仅描述契约，不写实现）：读取当前 `location.pathname` 的一级段（`/generate` / `/history` / `/characters`），对应 page 的外层 wrapper 加 `style={{display: active ? 'block' : 'none'}}`。对 `HistoryPage`，进入 `/history/:id` 时同属 `/history` 段，此时 `HistoryPage` 与 `HistoryDetailPage` 共存但只显示详情页（两者各自是独立 route 组件，但 HistoryDetailPage 不 keep-mounted，按 route 正常 mount / unmount）。

> 精确点：**仅顶层三个 page（Generate / History 列表 / Characters 列表）三者 keep-mounted**；`HistoryDetailPage` 是普通 route 组件随 URL 切换 mount/unmount（详情页无后台状态需保活）。

### `usePlayUrlPool` 接口

- 入参：`ids: string[]`（需要首帧的 task id 列表）
- 出参：`Map<id, { url?: string; status: 'idle' | 'loading' | 'ok' | 'error' }>`
- 行为：最多并发 **6** 个 `GET /api/tasks/{id}/play_url` 请求；超额排队；URL 1 小时内重用不重取；单项失败返回 `error` 但不阻塞其他项

## 错误处理 / 失败语义

- **路由匹配失败**（非 `/generate` / `/history[...]` / `/characters[...]`）：`Route path="*"` 重定向到 `/generate`，不弹错
- **HistoryDetailPage 的 id 不存在于 IDB**（手敲 URL / 旧链接）：详情页区域显示"未找到该作品"文案 + 返回列表按钮；**不** 抛异常、不跳回列表
- **History 卡 play_url 获取失败 / 视频 metadata load 失败**：卡片背景退化为纯色占位（token 浅冷灰），标题与时间正常显示，卡本身仍可点进详情页
- **Characters 创建表单提交失败**：沿用现有错误态，不改

## 关键流程

### 1. 应用启动 → 默认 Generate

1. `main.tsx` 渲染 `<BrowserRouter><App/></BrowserRouter>`
2. `App` 渲染 `<AppShell/>`，内部 `<Routes>` 定义 6 条路由
3. 首访 `/` → `Navigate to="/generate"`
4. AppShell 三个 page wrapper 首次渲染完成，`Sidebar` 高亮 Generate
5. 用户刷新任一 URL（如 `/history`）→ BrowserRouter 恢复路径，渲染对应页（不强制回 Generate，满足验收 94）

### 2. sidebar 切换 Generate → Characters

1. 点 Sidebar `Characters` NavLink → `navigate('/characters')`
2. `AppShell` 感知 `location.pathname` 变化 → GeneratePage wrapper `display:none`，CharactersPage wrapper `display:block`
3. GeneratePage 内部 `SubmissionWorkspace` 组件未 unmount，其内部轮询 hook 继续，进度状态保留
4. 切回 Generate：wrapper 切回 `display:block`，UI 立即呈现当前进度（满足验收 104）

### 3. History 列表首帧加载

1. HistoryPage mount → 读 IDB `history.getAll()` 得到成功任务清单（按 `finishedAt` 倒序）
2. 渲染 N 张 `HistoryCard`；每张 mount 时通过 `usePlayUrlPool` 注册自己的 id
3. pool 维护一个最多 6 并发的请求窗口：前 6 张立即发 `GET /api/tasks/{id}/play_url`，其余排队
4. 每拿到一个 URL → 对应卡设置 `<video src={url} preload="metadata" muted playsInline>`
5. video `onLoadedMetadata` → `video.currentTime = 0.1`；`onSeeked` 后浏览器自动渲染首帧
6. 1 小时内切出/切回该页：URL 仍有效，直接使用 cache（pool 内存中）

### 4. Characters 点占位卡 → 创建

1. 点 `NewCharacterCard` → `navigate('/characters/new')`
2. CharactersPage 检测 pathname = `/characters/new` → 在 grid 下方渲染 `CharacterCreateForm`（或 grid 被表单替换，具体布局 executor 决定）
3. 提交成功或点取消 → `navigate('/characters')` → 表单卸载，grid 刷新

### 5. Character 卡原位展开

1. 点任一 Character 卡 → 卡自身 `expanded = true`
2. 卡样式切换：`grid-row: span 2`，内容区垂直展开，展示大图 + Instructions
3. 同行其他卡不动；下方行整体下移（CSS grid 自动重排）
4. 再点收起 → `grid-row: span 1`

## 非功能性约束

- **性能**：History grid play_url 并发上限 6；首帧缩略图复用 URL 1 小时
- **可访问性**：Sidebar NavLink 带 `aria-current="page"`；keep-mounted 的非活动页面加 `aria-hidden="true" + inert`（或 `tabIndex=-1` + `pointer-events:none` 两件套）防止 Tab 意外进入
- **视觉契约**：见下节

## 决策清单

- **选 `react-router-dom` v6 不选自建 history hook**：成熟度 + 嵌套路由 + `/history/:id` 参数提取零成本；PROJECT.md "前端 HTTP 不引第三方"的节制原则针对 fetch 不针对路由；MVP 5 条 path 与详情页动态参数写自建 hook 节省不了多少
- **选三页全部 keep-mounted 不选 Context 外提任务状态**：需求 86 明确"内部组件逻辑不改动"；外提任务状态等于重写 SubmissionWorkspace，越界
- **选 `<video preload=metadata>` 不选 canvas 生成 Blob 存 IDB**：后者要 `DB_VERSION+1` + IDB upgrade + 改 history record 字段，与需求 85 "不动后端/DB schema" 与 86 "只动 UI 骨架"边界冲突
- **选 `/characters/new` 与 `/characters` 共用 CharactersPage**：需求明确"主区切换为创建表单态"，不是跳独立页；若拆成独立 route component，grid 与表单会 unmount/mount 抖动
- **选原位纵向抽高不选满行展开**：minimal-refined 基调要求布局安静；满行展开每次点卡都让整屏重排，视觉噪音大
- **选限流 6 并发 play_url**：对单用户 MVP 既不让浏览器同时 burst 数十个 UFile 预签请求，也不让可见卡等太久

## 留到执行时再决定

- **Sidebar 图标具体形状**（Generate / History / Characters）：executor 在 frontend-design skill 指导下从 lucide-react 或同类库挑选；未选定前用占位 SVG
- **Sidebar 宽度在 64–80px 区间具体取值、卡片 radius、gap、渐变叠层高度与透明度曲线、展开卡高度动画参数**：executor 结合视觉契约 + frontend-design skill 决定；DESIGN 不预先固定 px
- **返回 History 列表的交互形态**（面包屑 vs 显式返回按钮 vs 两者兼具）：executor 在 HistoryDetailPage 实现时结合 PageHeader 空间决定
- **`/characters/new` 的 CharactersPage 布局**（表单替换 grid / 表单在 grid 下方 / 表单覆盖 grid 的上半部）：executor 实现时现场判断，保证"不弹 modal、不跳页"即可

## 视觉契约

沿用 `.cadence/PROJECT.md` 的视觉契约。
