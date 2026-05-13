# Character 库 技术方案

本轮 cycle 在现有 mays-vlog 前端工程内增量交付一个**纯前端**的角色资料库：复用现有 IndexedDB 数据库 `mays-vlog`，新增一个 `characters` object store；角色参考图以 Blob 形式存进 IDB；新增一个独立的 `CharacterDrawer` 组件作为入口，从主界面 header 右上按钮触发，与现有 `HistoryDrawer` 同侧互斥（打开一个自动关闭另一个）。**不动后端，不新增任何 `/api/*` 端点，不修改 modelverse / ufile / orchestrator 任何一行代码**。

## 技术栈
- 沿用现有前端栈：React 18.3 + TypeScript + Vite + `idb` v8（DBSchema）+ CSS Modules + `:root` design tokens
- 新增依赖：**无**
- 后端：**0 改动**

## 模块划分

| 模块 | 路径 | 状态 | 职责 |
|---|---|---|---|
| 角色持久化层 | `frontend/src/storage/charactersDb.ts` | 新增 | IDB 中 `characters` store 的 CRUD + 唯一性校验；暴露 `listCharacters` / `createCharacter` / `deleteCharacter` |
| 角色 React hook | 与 history 现有惯例对齐（独立文件或并入 `charactersDb.ts`） | 新增 | 抽屉打开时读列表、create/delete 后乐观刷新 |
| 现有 IDB schema 持有者 | `frontend/src/storage/historyDb.ts`（或同目录共享 DB 入口） | 修改 | DB version `+1`；在 `onUpgradeNeeded` 中 `createObjectStore('characters', ...)` 并建立索引 |
| Character 抽屉根 | `frontend/src/components/CharacterDrawer/CharacterDrawer.tsx` | 新增 | 抽屉容器；维护「列表 / 创建表单」两态；进出动效沿用 HistoryDrawer 同款 |
| Character 卡片 | `frontend/src/components/CharacterDrawer/CharacterCard.tsx` | 新增 | 卡片自身展开/折叠 + 删除二次确认（卡内内联变态） |
| 新建占位卡 | `frontend/src/components/CharacterDrawer/NewCharacterCard.tsx` | 新增 | 网格首格占位卡；点击切到创建表单态 |
| 创建表单 | `frontend/src/components/CharacterDrawer/CharacterCreateForm.tsx` | 新增 | 图片上传 + Name + Instructions + 创建 / 取消 |
| 顶部入口 & 抽屉协调 | 现有挂 History 入口的父组件（如 `SubmissionWorkspace.tsx`） | 修改 | header 右上 History 按钮旁加 Characters 按钮；维护 `openDrawer: 'none' \| 'history' \| 'characters'` 单值状态实现同侧互斥 |

## 数据模型

### IndexedDB
- 复用现有 `mays-vlog` 数据库；DB version 当前号由 task-executor 读代码确定，本次必须 `+1`。
- 新增 object store `characters`：
  - `keyPath: 'id'`（string，`crypto.randomUUID()` 生成）
  - 索引：
    - `by_created_at` on `createdAt`（用于倒序读列表）
    - `by_name_key` on `nameKey`（`unique: true`，唯一性查重）

### Character 实体字段

| 字段 | 类型 | 备注 |
|---|---|---|
| `id` | string | UUID |
| `name` | string | trim 后保留原大小写存储（用于展示） |
| `nameKey` | string | `name.trim().toLowerCase()`，唯一索引键 |
| `instructions` | string \| undefined | 自由文本，不做长度硬限 |
| `image` | Blob | 参考图本体；MIME 限 `image/png` / `image/jpeg` / `image/webp` |
| `createdAt` | number | epoch ms |

> 命名建议 camelCase（纯前端实体，不跨后端边界，不违反 PROJECT.md「跨边界保留 snake_case」约定）。

## 接口设计（前端持久化层 API）

| 函数 | 入参 | 出参 / 错误 |
|---|---|---|
| `listCharacters()` | — | `Promise<Character[]>`；按 `createdAt` 倒序 |
| `createCharacter(input)` | `{ name: string, instructions?: string, image: Blob }` | `Promise<Character>`；可能抛 `EmptyNameError` / `DuplicateNameError` / `InvalidImageError` |
| `deleteCharacter(id)` | `string` | `Promise<void>` |

错误分类：
- 空 Name（trim 后为空）→ `EmptyNameError`
- trim+toLowerCase 后已存在 → `DuplicateNameError`
- image MIME 不在允许集合 → `InvalidImageError`
- IDB 底层写入失败 → 透传原始 DOMException

## 关键流程

### 打开抽屉
1. 用户点击 header 右上 `Characters` 按钮
2. 父组件设 `openDrawer = 'characters'`；若先前是 `'history'`，HistoryDrawer 同帧退出
3. CharacterDrawer 首次挂载触发 `listCharacters()`；得到列表后渲染网格
4. 抽屉默认进入「列表态」

### 创建角色
1. 用户点击「新建角色」占位卡 → 抽屉切到「创建表单态」（顶部变 `← 返回 | 新建角色`）
2. 选图片：`<input accept="image/png,image/jpeg,image/webp">`，提交前再做一次 MIME 二次校验；选中后表单内 `<img>` 预览
3. 填 Name（必填）+ Instructions（可选）
4. 点「创建」：
   - 客户端校验：name trim 非空 / nameKey 不重复 / image 已选 / MIME 合法
   - 通过 → `createCharacter` 写 IDB → 列表 prepend → 抽屉切回「列表态」
   - 失败 → 表单内显示对应错误文案，不切态
5. 点「取消」/「返回」→ 抽屉切回「列表态」，丢弃图片与输入

### 查看角色
1. 点卡片头部 → 原地内联展开，下方显示完整 Instructions 与「删除」按钮
2. 再次点卡片头部 → 折叠
3. 多卡可并存展开（每张卡独立状态）

### 删除角色
1. 展开态卡内点「删除」→ 同位置变态为「确认删除 | 取消」两个内联按钮
2. 点「确认删除」→ `deleteCharacter(id)` → 从列表移除 → revoke 该卡用过的 object URL
3. 点「取消」→ 回到普通展开态，按钮恢复为「删除」

### 关闭抽屉 / 切到另一抽屉
1. 组件 unmount 时统一 `URL.revokeObjectURL` 所有该抽屉生成的 object URL
2. 抽屉关闭→重新打开 → 重置为「列表态」（不保留展开/表单态）

## 非功能性约束
- **持久化范围**：仅本浏览器 IndexedDB；清缓存 / 换浏览器 / 换设备会丢，与现有 history 口径一致
- **图片格式**：仅 png/jpeg/webp；不硬限大小，但表单底部放提示「过大图片会拖慢加载」
- **图片渲染**：`URL.createObjectURL`；卡片 unmount / 删除 / 抽屉关闭时 `revokeObjectURL`
- **后端 / API**：本轮 0 改动；现有 prompt 生成流 UI 与 API 行为保持不变
- **路由**：单页应用无路由；抽屉态由父组件本地 state 管，不写入 URL
- **可观测**：错误 `console.error`，不上报

## 决策清单
- **复用 mays-vlog IDB 新增 store，不开新 DB**：与 PROJECT.md `idb` 约定一致；多 store 是 idb 标准用法；未来若要导出/迁移，单 DB 更方便
- **图片存 Blob 不存 base64**：IDB 原生支持，无 ~33% 膨胀；渲染走 object URL；纯本地不需要 JSON 序列化
- **CharacterDrawer 与 HistoryDrawer 同侧互斥**：视觉聚焦、不打架；用统一的 `openDrawer` 单值状态实现，避免两个 boolean 互相不知道
- **创建表单走「抽屉两态切换」**：贴合需求「不弹 modal、不跳页」；表单空间充裕，逻辑简单
- **删除二次确认走「卡内内联变态」**：同样贴合「不弹 modal」原则
- **Name 唯一性 trim + toLowerCase**：用户视角下「Alice」「  alice」是同一个角色；存储保留原大小写用于展示
- **入口按钮放 header 右上与 History 并排**：所见即所得；与现有抽屉触发模式一致
- **不在 `frontend/src/api/` 加任何东西**：本轮无新增后端调用
- **不接入生成流程**：留给下一轮 cycle

## 留到执行时再决定

| 项目 | 判定时点 |
|---|---|
| DB version 具体号 | task-executor 读 `historyDb.ts` 当前 version，本次 `+1` |
| `useCharacters` 是独立文件还是合入 `charactersDb.ts` | 看 history 现有惯例对齐 |
| 字段命名 camelCase vs snake_case（若 history 也是 camelCase 则统一 camelCase） | task-executor 评估；本设计倾向 camelCase |
| 抽屉宽度、卡片网格列数、卡片宽高比、内边距、字号 | task-executor + frontend-design skill 结合视觉契约决定 |
| 抽屉进出动画曲线 / 时长 / 方向 | 沿用 HistoryDrawer 同款 |
| 表单字段 spacing、按钮位置、错误文案措辞 | task-executor 决定，遵守视觉契约 |
| Name / Instructions 是否设 maxLength | MVP 建议不设；task-executor 自决 |
| 图片预览的 object-fit / 圆角 / 占位尺寸 | task-executor + frontend-design 决定 |
| 卡片展开是否单选（同时只展开 1 张） | 本设计选「多卡并存展开」；实现时若觉得拥挤可改单展开 |
| header 上 Characters 入口的图标 / 标签 | task-executor 决定，遵守视觉契约 |

## 视觉契约
沿用 `.cadence/PROJECT.md` 的视觉契约。
