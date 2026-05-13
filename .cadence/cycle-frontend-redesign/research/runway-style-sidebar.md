# Runway / Pika / Luma 等 AI 视频生成产品的左侧分类菜单形态

> 调研主题：Runway / Pika / Luma 等 AI 视频生成网页产品的左侧分类菜单（sidebar navigation）布局形态、视觉规范与信息架构
> 调研日期：2026-05-13

## 1. 一句话结论
这类产品的左侧栏是一个**常驻、可折叠（展开 ~240px / 折叠 ~56–64px）的窄竖向导航**，承担"在主区切换不同工作面（创作 / 资源浏览 / 角色库 / 模板）"的角色——本质是"主区路由器 + 资源库入口"，不是抽屉、不是 floating，且会把"角色 / 参考素材库"作为独立一级入口而不是埋在创作面板里。

## 2. 关键事实

### 2.1 Runway（行业最完整的参考样本）
- **官方一级入口（2025–2026 现行顺序，自上而下）**：Dashboard · Apps · Workflows · **Characters** · Runway Watch；接着是一个 `CREATE` 分组分隔，下面是 Generate Video / Generate Image / Generate Audio；底部是 Help Center 与 Terms/Privacy（来源：[Runway Dashboard 页面文本](https://app.runwayml.com/dashboard)，2026-05-13 抓取；与 [Runway Academy Dashboard Guide](https://academy.runwayml.com/getting-started/dashboard-overview) 描述一致）。
- **左上 / 左下分区惯例**：左上角是 home/dashboard 图标返回主页；账户管理放在**左上角 workspace 头像**与**右上角个人头像**两个位置（Workspace 设置 vs 个人账户分开），底部留 Help / 法律链接。
- **Characters 是一个独立一级入口**：可从 sidebar 直接进入 `app.runwayml.com/characters`，用于建立"可复用角色库"——用户上传参考图、命名、保存，未来在生成面板可以**用 `@角色名` 直接调用**，跨 session 持续可用（来源：[Runway Resources – AI Character References Tips](https://runwayml.com/resources/ai-character-references-tips)，2026-05-13 抓取）。
- **Assets / Library 是另一类入口**：所有上传与生成的资产统一进 Assets/Library，支持 list ↔ grid 视图切换（右上角 toggle），grid cell 显示缩略图 + 上下文 menu（重命名 / 下载 / 删除 / 隐私 globe vs lock 图标）。详见 [Runway – Managing assets](https://help.runwayml.com/hc/en-us/articles/4408611980563-Managing-assets)（2026-05-13 抓取）。
- **资源 → 创作的"用进来"流程**：在 Generate Image / Generate Video 面板里有 References 开关，开启后从已保存库里拉素材进当前 prompt——也就是说"素材库是独立 sidebar 入口，但创作面板里有一个引用面板拉取它"。
- **2025 年下半年官方更新明确提到** "newly designed navigation sidebar makes it easier to access commonly used tools"（来源：[Runway Changelog](https://runwayml.com/changelog)，2026-05-13 通过 search 摘录，原页面 fetch 受限，时间未确认精确到日）。

### 2.2 Luma Dream Machine（极简对照样本）
- **左侧栏只有两个一级 toggle**：**Boards**（项目化分组——按主题/项目组织一组生成物）和 **Ideas**（账户全量生成流，所有图 + 视频都在这里）。
- **底部**：左下角是 profile 头像 → 订阅 / 账单 / 积分管理。中下/底部有 `+` 按钮新建 Board。
- **Character/Style/Visual Reference 不是一级入口**：而是创作输入区里的"控制 pill"——Camera Motion / Style reference / Visual Reference / Character Reference 四个并列，靠近 prompt 输入框（来源："Dream Machine Guide: Navigating Boards & Ideas" 与 "Web quick start"，[lumalabs.ai/learning-hub](https://lumalabs.ai/learning-hub)，2026-05-13 通过 search 抓取摘要，原页面 fetch 受限）。
- 这种极简两级（"项目" + "全部"）适合**轻量探索型**产品；Runway 的多入口适合**工作流型**产品。

### 2.3 Pika（生成中心型，弱 sidebar）
- 没有强 sidebar，主导航是 **Prompt Box（中央）+ My Library（"我的生成"）+ Explore（社区发现）** 的横向 tab/导航。
- Library 是"My Library" 个人生成流，Explore 是公共 inspirations。
- 角色 / 参考机制是**输入区内联**的（image upload / motion controls / aspect ratio 等都贴着 prompt 框），没有独立 character library 入口。
- 来源："Pika Labs AI Video Generation Interface Guide"（[pikaais.com/interface](https://pikaais.com/interface/)）与 "How to use Pika 1.0"（[pikalabsai.org](https://pikalabsai.org/how-to-use-pika-new-version-1-0/)），2026-05-13 search 摘录。

### 2.4 共性视觉规范（行业惯例 + 主流组件库默认值）
| 维度 | 行业惯例值 |
|---|---|
| 展开宽度 | 240–300px（shadcn 默认 `15rem ≈ 240px`） |
| 折叠（icon-only）宽度 | 48–64px（shadcn `SIDEBAR_WIDTH_ICON = 4rem ≈ 64px`；achromatic 用 56px） |
| 一级入口数量上限 | 5–7 个，超过要分组 |
| 菜单项行高 | ~36px |
| 图标命中区 | 内部 ≥27×27px，边角 ≥44×44px（touch） |
| 折叠态必备 | hover tooltip 显示完整 label |
| 折叠状态持久化 | 写 localStorage，跨刷新保留 |
| 顶部 / 底部分区 | 顶：logo / workspace switcher；底：user menu / settings / help |
| 分组分隔 | 用一个小 label（如 `CREATE`）+ 极淡分割线，不要画粗线 |

（来源：[shadcn/ui Sidebar 文档](https://ui.shadcn.com/docs/components/sidebar)、[Achromatic – Using the new Shadcn Sidebar](https://www.achromatic.dev/blog/shadcn-sidebar)、[Alf Design Group – Sidebar Design for Web Apps 2026](https://www.alfdesigngroup.com/post/improve-your-sidebar-design-for-web-apps)，均 2026-05-13 抓取）

### 2.5 主区与左侧的关系（三种主流模式）
- **整页切换型（Runway / Luma 主流）**：点 sidebar 一级项，主区是**整页 route**——从 "正在生成" 切到 "Characters 库列表" 是一次明确的路由跳转，不是浮层，不是分屏。回到生成靠点 `Generate Video` 入口。
- **保留生成 + 浮层资源浏览（少数）**：极少产品保留"主区始终是生成画布"+ 资源库以右侧 drawer 或 modal 弹出。Pika 接近这种（中央始终是创作，library/explore 是 tab 切换）。
- **创作面板内联引用（普遍存在，作为补充）**：即使是 Runway，"在生成里用 character" 也不是跳到 Characters 页选一个再回来——而是在生成面板的 References 子面板里拉。这意味着**素材库需要在两个地方都可达**：sidebar 一级入口（管理 / 浏览全量）+ 创作面板内联拉取（消费 / 引用进当前生成）。

## 3. 取舍对比

### 3.1 三种 sidebar 形态对照

| 维度 | Runway 型（多入口工作流） | Luma 型（双 toggle 极简） | Pika 型（弱 sidebar / 横向） |
|---|---|---|---|
| sidebar 一级数 | 5–8 个 + 分组 | 2 个（Boards / Ideas） | 0（或 2–3 个顶部 tab） |
| 角色/素材库 | 独立一级入口 | 输入区内联 pill | 输入区内联 |
| 主区切换方式 | 路由整页切换 | 路由整页切换 | 中央常驻 prompt，tab 切 library |
| 适合产品类型 | 复杂工作流 / 多模态 / 团队 | 单流探索 / 个人创作 | 单流即发即看 / 社区分享 |
| 实现复杂度 | 高 | 低 | 低 |
| 单用户 MVP 适配度 | 偏重 | **适中** | 适中 |

### 3.2 对你当前 MVP 的映射建议（仅给参考，不替你做决策）
- 你现有的 `openDrawer: 'none' | 'history' | 'characters'` 互斥抽屉，本质是把 sidebar 的"路由切换"用浮层模拟了一遍——这是**典型的"从抽屉时代过渡到 sidebar 时代"前夜的形态**。
- 若想靠近 Runway 形态：左侧改成常驻竖向 sidebar，至少 3–4 个一级入口（Generate / History / Characters / Showcase），主区随选择整页切换；HistoryDrawer 的"列宽塌缩到 0"机制可以保留为 sidebar 自身的折叠态（56–64px icon-only）。
- 若想靠近 Luma 形态：左侧两个 toggle（"Workspace 创作" / "Ideas 我的生成"），Characters 不上 sidebar 而做成 prompt 输入区上方的 pill。
- "展示参考" 这个用户提到的入口在行业里有两种主流落点：(a) Runway 式 **Explore / Templates / Apps**（精选案例 + 可一键 fork prompt）；(b) Pika 式 **Explore 社区流**（其他人作品 inspire）。单用户本机 MVP 建议先做 (a) 的极简版——"内置示例 prompt + 期望产物"——而不是社区流。

**没有"推荐方案"**，因为 Runway 型 vs Luma 型差异不是"哪个更对"，而是"产品想覆盖几个工作流"。这个决策应该回到主 agent 跟用户确认：到底要不要 Characters 之外的第三类资源，以及 Generate 是否要拆成多个一级入口。

## 4. ASCII 草图：三种典型骨架

### 4.1 Runway 型（推荐重点参考）
```
┌─────┬─────────────────────────────────────────────────────┐
│ ▲LG │ Dashboard                                            │
│     │                                                      │
│ ▣Dsh│                                                      │
│ ▣App│   ┌──────────────────────────────────┐               │
│ ▣Wfl│   │     主区：路由切换内容            │              │
│ ▣Chr│   │   (Dashboard / Generate / Chars / │              │
│ ▣Wch│   │    Library / Workflows 整页)      │              │
│ ─── │   └──────────────────────────────────┘               │
│ CREATE                                                     │
│ ▶Vid│                                                      │
│ ▶Img│                                                      │
│ ▶Aud│                                                      │
│     │                                                      │
│ ?Help                                                      │
│ ◉Usr│                                                      │
└─────┴─────────────────────────────────────────────────────┘
 240px            主区填满剩余
```
折叠态：
```
┌──┬────────────────────────────────────────────────────────┐
│▲ │ (主区拿回 ~180px 宽)                                    │
│▣ │                                                         │
│▣ │   hover icon 弹 tooltip："Characters"                   │
│▣ │                                                         │
│▣ │                                                         │
│▣ │                                                         │
│─ │                                                         │
│▶ │                                                         │
│▶ │                                                         │
│▶ │                                                         │
│? │                                                         │
│◉ │                                                         │
└──┴────────────────────────────────────────────────────────┘
 56–64px
```

### 4.2 Luma 型（极简双 toggle）
```
┌─────┬─────────────────────────────────────────────────────┐
│     │                                                      │
│Bds  │                                                      │
│Idea │   ┌─────────────────────────────────────┐            │
│     │   │  主区根据 Boards/Ideas 切换          │           │
│     │   │  底部是大 prompt 输入区              │           │
│     │   │  prompt 上方 pill: [Cam] [Style]     │           │
│     │   │  [Visual Ref] [Char Ref]             │           │
│     │   └─────────────────────────────────────┘            │
│     │   ┌─────────────────────────────────────┐            │
│     │   │ ✏ 描述...                    Generate │           │
│     │   └─────────────────────────────────────┘            │
│ +   │                                                      │
│ ◉Usr│                                                      │
└─────┴─────────────────────────────────────────────────────┘
```

### 4.3 资源浏览区（Library / Assets）grid 子布局
```
┌──────────────────────────────────────────────────────────┐
│ Library                          [List | Grid] [Upload] [↓] │
├──────────────────────────────────────────────────────────┤
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐                          │
│  │thumb│ │thumb│ │thumb│ │thumb│   3–5 列响应             │
│  │ ▶  │ │ ▶  │ │ ▶  │ │ ▶  │   悬浮显示 menu             │
│  │ ⓘ🔒│ │ ⓘ🌐│ │ ⓘ🔒│ │ ⓘ🔒│   隐私 icon 角标            │
│  └────┘  └────┘  └────┘  └────┘                          │
│  名称     名称     名称     名称                          │
│  时间     时间     时间     时间                          │
└──────────────────────────────────────────────────────────┘
```

### 4.4 角色库 / 素材库的"双重可达性"模式
```
sidebar 一级 (管理视图)            创作面板内联 (消费视图)
┌─────┐                            ┌──────────────────────┐
│Chr ─┼─→ /characters             │ Generate Video        │
│     │   全量列表/CRUD            │ ┌─────┐              │
└─────┘                            │ │prom │ Refs: [+@xxx]│
                                   │ └─────┘    ↑         │
                                   └────────────┼─────────┘
                                                │
                                  从同一个 store 拉
```

## 5. 引用来源
- [Runway Dashboard](https://app.runwayml.com/dashboard) — 官方应用主页（提供 sidebar 一级入口顺序），2026-05-13 抓取
- [Runway – Navigating Runway (Help Center)](https://help.runwayml.com/hc/en-us/articles/24298206897043-Navigating-Runway) — 官方文档，2026-05-13 通过 search 摘录（直接 fetch 在本环境受限）
- [Runway Academy – Dashboard Overview](https://academy.runwayml.com/getting-started/dashboard-overview) — 官方教学，2026-05-13 通过 search 摘录
- [Runway – Managing assets](https://help.runwayml.com/hc/en-us/articles/4408611980563-Managing-assets) — 官方文档（Library list/grid 切换、cell menu），2026-05-13 抓取
- [Runway Resources – AI Character References Tips](https://runwayml.com/resources/ai-character-references-tips) — 官方资源页（Characters 库与 @ 引用机制），2026-05-13 抓取
- [Runway – Creating with Gen-4 Image References](https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References) — 官方文档（创作面板内联引用），2026-05-13 抓取
- [Runway Changelog](https://runwayml.com/changelog) — 官方更新日志（确认 2025 sidebar 重设计），2026-05-13 抓取（具体日期未确认）
- [Luma – Dream Machine Guide: Navigating Boards & Ideas](https://lumalabs.ai/learning-hub/navigating-boards-ideas) — 官方学习中心，2026-05-13 通过 search 摘录（fetch 受限）
- [Luma – Dream Machine Guide: Web quick start](https://lumalabs.ai/learning-hub/web-quick-start) — 官方学习中心，2026-05-13 通过 search 摘录
- [Pika Labs Interface Guide](https://pikaais.com/interface/) — 第三方专题站（Pika UI 描述），2026-05-13 抓取
- [How to use Pika 1.0](https://pikalabsai.org/how-to-use-pika-new-version-1-0/) — 第三方教程（My Library / Explore tab 描述），2026-05-13 抓取
- [shadcn/ui – Sidebar 组件文档](https://ui.shadcn.com/docs/components/sidebar) — 官方组件文档（width/icon 模式 API），2026-05-13 抓取
- [Achromatic – Using the new Shadcn Sidebar](https://www.achromatic.dev/blog/shadcn-sidebar) — 实现参考（56px collapsed / 36px row），2026-05-13 抓取
- [Alf Design Group – Sidebar Design for Web Apps (2026 Guide)](https://www.alfdesigngroup.com/post/improve-your-sidebar-design-for-web-apps) — 设计指南（240–300 / 48–64 / 5–7 项规范），2026-05-13 抓取
- [UX Planet – Best UX Practices for Designing a Sidebar](https://uxplanet.org/best-ux-practices-for-designing-a-sidebar-9174ee0ecaa2) — 通用 UX 实践，2026-05-13 抓取
