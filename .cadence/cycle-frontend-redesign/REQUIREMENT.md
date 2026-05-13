# 前端布局重构：sidebar 多入口 + 主区整页切换

当前 MVP 前端是 "主区 SubmissionWorkspace + grid 左列常驻 HistoryDrawer + fixed 浮层 CharacterDrawer" 的 "主区 + 抽屉" 形态。本次重构对齐 Runway 主页视觉骨架——左侧改为常驻、icon + label 竖向窄 sidebar，承载 3 个一级入口（Generate / History / Characters），主区随选择整页切换；HistoryDrawer 与 CharacterDrawer 两个抽屉容器整体废除。Character 与 History 列表的展示样式参考 Runway Characters 列表页的 grid 大卡（缩略图满铺 + 底部渐变 + 标题）。视觉契约（minimal-refined / 浅色 / 冷色系 / accent `#1d4ed8` / IBM Plex Sans）整体保留。本次**只动 UI 骨架与样式**，不动内部能力（不补 Character 编辑、不接入生成流）。

## 做什么

### 整体布局
- 左侧常驻 sidebar：宽度约 **64–80px**，icon + 下方小字 label 竖向堆叠（参考 Runway 主页风格，**永远窄态**，无展开/折叠两态）
- sidebar 顶部：一个小 logo / 应用名
- sidebar 底部：留空（不放账户 / 设置 / 帮助 / 反馈）
- sidebar 一级入口（自上而下）：
  - **Generate**（生成）
  - **History**（历史作品）
  - **Characters**（角色库）
- 选中态：图标 + 文字加深 + 左侧细竖线指示
- 主区：填满 sidebar 右侧剩余区域
- 主区顶部 header：仅左侧放当前页标题；右侧留空（不放 credits / Dev Portal / Contact Sales / 操作按钮）

### 路由
- URL 路径反映当前页：
  - `/generate`
  - `/history`
  - `/history/{id}`
  - `/characters`
  - `/characters/new`
- 默认入口 → `/generate`
- 浏览器刷新后保留在当前页（不强制跳回 Generate）
- 技术选型（用什么路由库 / 怎么集成）留给 design 阶段决定

### Generate 页
- 包装现有 SubmissionWorkspace（PromptInput + 可选首帧图 + ProgressPanel + VideoPlayer）
- **内部组件逻辑不动**，仅外层重排以适配新整页框架
- 顶部 header 文案：`Generate`

### History 页
- 顶部 header 文案：`History`
- 主区是 grid 卡片（**参考 Runway Characters 列表样式**）：
  - 每张卡：视频首帧缩略图**满铺**卡片背景 + 底部渐变叠层 + 标题（`title`）+ 完成时间（`finishedAt` 相对时间）
  - 列数与卡片尺寸：design 阶段决定（图参考 4 列）
- 数据来源：现有 IndexedDB `history` store（与原 HistoryDrawer 同源；只看 `success`）
- 点击卡片 → 进入 `/history/{id}` **独立详情页**：复用现有 HistoryDetail 组件视觉骨架（大视频播放器 + prompt / 元数据 / 下载），顶部提供返回 History 列表的入口（面包屑或返回按钮）
- 空态：grid 中央显示空态提示，引导去 Generate

### Characters 页
- 顶部 header 文案：`Characters`
- 主区是 grid 卡片（**参考 Runway Characters 列表样式**）：
  - **首位永远是占位卡**：浅色背景 + `+` icon + `New Character` / `Create your own`（与其他卡尺寸一致，样式更轻）
  - **每张角色卡**：参考图**满铺**卡片背景 + 底部渐变叠层 + 角色 `Name`
  - **不放** Preset 类 chip（本项目所有角色都是用户自建）
- 数据来源：现有 IndexedDB `characters` store
- **点击占位卡** → 主区切换为创建表单态，URL 变 `/characters/new`：
  - 表单字段保留现状：参考图（上传 / 拖入）+ Name + Instructions + 提交 + 取消
  - 提交成功或取消后 → 回到 `/characters` 列表态
- **点击任意角色卡** → 卡片内联展开（保留现状交互）：
  - 展示 Name / Instructions / 参考图大图
  - 再点收起
- **删除**：保留现状"卡内二次确认"模式（不弹 modal、不跳页）
- 空态：grid 中仅展示占位卡（无其他卡时）即可，无需额外空态文案

### 视觉
- 保留现有 :root design tokens：accent `#1d4ed8` / 浅色 / 冷色系 / IBM Plex Sans / minimal-refined
- 新增组件级样式（卡片满铺、渐变叠层、sidebar 选中态等）在现有 token 体系内派生
- 不引入暗色 / 不换字体 / 不换主调色

### 去除项（代码层面必须移除）
- `HistoryDrawer` 容器组件（grid 左列常驻 + 列宽塌缩开关）
- `CharacterDrawer` 容器组件（fixed 浮层 + 列表 / 创建两态切换外壳）
- `openDrawer: 'none' | 'history' | 'characters'` 抽屉互斥状态机
- 主界面 header 上原抽屉触发按钮（点 sidebar 入口替代）

## 不做什么

- **Character 编辑**（改名 / 换图 / 改描述）—— 仍为已知限制，留给后续 cycle
- **Character 接入生成流程**（Generate 页选角色一起生成）—— 仍为已知限制，留给后续 cycle
- **跨页可见的生成进度**：不加全局顶部状态栏；不在 sidebar Generate 图标加 badge / 状态点；任务在后端继续跑，但必须切回 Generate 才能看到进度
- **视觉契约改动**：不改主色 / 字体 / 间距 token / 字号尺度
- **sidebar 折叠态**：sidebar 永远窄态 icon + label，**不**做 240px 展开 / 64px 折叠两态切换
- **sidebar 底部账户 / 设置 / 帮助 / 反馈入口**：MVP 单用户本机不需要
- **主区顶部 header 右侧操作组**：不放任何按钮（如 credits / Dev Portal / Contact Sales / 设置 / 新建 / 清空等页面级操作）
- **History 卡 hover 操作**：不在卡上叠加删除 / 下载等快捷操作（详情页内提供即可）
- **History list 视图切换**：不提供 List ↔ Grid 切换 toggle（只 Grid 一种）
- **移动 / 平板适配**：沿用现有"仅桌面端浏览器"限制
- **暗色模式 / 多语言**：沿用现有限制
- **键盘快捷键**（Cmd+1/2/3 切 sidebar 等）：本次不做
- **后端任何改动**：不动 API / DB schema / 任务编排 / SDK 调用
- **内部组件逻辑改动**：PromptInput / VideoPlayer / ProgressPanel / 创建表单字段逻辑等不改动，本次只在外层重排
- **社区流 / 外部参考流 / inspirations**：不引入

## 验收

- [ ] 用户进入应用默认看到 Generate 页，URL 是 `/generate`
- [ ] 用户在左侧能看到一条永远窄态的 sidebar，3 个一级入口（Generate / History / Characters）以 icon + 下方 label 竖向排列
- [ ] 用户点击任一 sidebar 入口，主区整页切换到对应内容，URL 同步变化
- [ ] 用户在任一页刷新浏览器后停留在当前页（如刷新 `/history` 仍回到 History 而不是 Generate）
- [ ] 用户在 History 页能看到所有已成功的视频作品 grid 卡片，每张卡是"视频首帧满铺背景 + 底部渐变叠层 + 标题 + 时间"样式
- [ ] 用户在 History 页点击任一卡片 → 进入 `/history/{id}` 独立详情页，能播放视频并查看 prompt / 元数据
- [ ] 用户在 History 详情页能通过面包屑或返回按钮回到 History 列表
- [ ] 用户在 Characters 页能看到 grid 卡片，首位是带 `+` icon 的占位卡，其余每张是"参考图满铺背景 + 底部渐变叠层 + Name"样式
- [ ] 用户点占位卡 → 主区切换为创建表单态，URL 变 `/characters/new`，能填参考图 / Name / Instructions
- [ ] 用户在创建表单态点提交或取消后回到 Characters 列表态（URL 回 `/characters`）
- [ ] 用户点任一 Character 卡能在卡内联展开，看到 Name / Instructions / 参考图大图；再点收起
- [ ] 用户在 Character 卡上点删除有"卡内二次确认"交互（与现状一致）
- [ ] 用户在 Generate 页发起生成后切到 History / Characters 页，应用任何位置都看不到全局进度提示
- [ ] 用户在 Generate 页发起生成后切到其他页再切回 Generate，能继续看到当前任务的进度（任务未中断、进度未丢失）
- [ ] 应用代码中已无 `HistoryDrawer` / `CharacterDrawer` 抽屉容器组件，也无 `openDrawer` 抽屉互斥状态机
- [ ] 应用整体视觉契约保持：accent 仍 `#1d4ed8` / 字体仍 IBM Plex Sans / 浅色冷色基调不变
- [ ] 现有 `Character 编辑` 与 `Character 接入生成流程` 两项已知限制本轮**不**消除（继续作为已知限制存在）
