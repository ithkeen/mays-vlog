# `frontend/src/components/CharacterDrawer/`

Character 库抽屉的 UI 组件集合。本目录承担 Character 库 cycle 引入的所有视图层，与现有 `HistoryDrawer.tsx`（位于上一级目录）同侧但互斥，互不耦合。

视觉契约（PROJECT.md 锁定）：minimal-refined / 浅色 / 冷色系 / 单一冷蓝 accent（`#1d4ed8`）/ 无衬线（IBM Plex Sans）。本目录所有 CSS 一律走 `:root` design tokens，不写裸色值 / 裸字号。

## 子组件职责矩阵

| 文件 | 职责 | 当前状态 |
|---|---|---|
| `CharacterDrawer.tsx` / `.module.css` | 抽屉根容器：受控 `open` / `onClose` 协议；维护「列表 / 创建表单」两态切换；列表加载与角色删除编排；不持有 object URL 引用（交由 CharacterCard 自管） | T5 已交付 |
| `CharacterCard.tsx` / `.module.css` | 列表态下的角色卡片：参考图 + Name + 展开内联 Instructions + 删除二次确认 | T4 已交付 |
| `NewCharacterCard.tsx` / `.module.css` | 网格首格的「新建角色」占位卡；点击触发 `onClick` 由外部决定如何切态 | T3 已交付 |
| `CharacterCreateForm.tsx` / `.module.css` | 创建表单：图片上传 + Name + Instructions + 创建 / 取消；直连持久层 `createCharacter` | T3 已交付 |

## `CharacterDrawer`

**props**：

```ts
type CharacterDrawerProps = {
  /** 抽屉是否打开。受控；父组件持有「是否打开」的状态。 */
  open: boolean
  /** 用户请求关闭（ESC / 后续 T6 接入的关闭按钮）。 */
  onClose: () => void
}
```

**两态切换**：

- 内部 `view: 'list' | 'create'` state，默认 `'list'`。
- 点 `NewCharacterCard` → `setView('create')`，顶部变为「← 返回 | 新建角色」。
- 「← 返回」/ `CharacterCreateForm.onCancel` / `CharacterCreateForm.onCreated` → `setView('list')`。
- 抽屉 `open` 由 false → true 时强制重置回 `'list'` 态（acceptance：再次打开不保留先前展开态 / 表单态）。

**列表数据**：

- 首次打开抽屉（`open` 变 true 且尚未加载过）调一次 `listCharacters()` 并写入内部 `characters` state。
- 后续同一会话内只做乐观刷新（创建 prepend、删除 filter），不再访问 IDB（与 history 抽屉「本地权威」口径一致——Character 库无后端，IDB 即权威）。
- 首格固定渲染 `NewCharacterCard`，后续按 `createdAt` 倒序由 `listCharacters` 内部游标实现（`by_created_at` 索引 prev cursor）。
- 列表加载中且无缓存：渲染 `LOADING…` 占位（mono 字体小写灰）。
- 列表为空（已加载完成）：仅 `NewCharacterCard` 单卡居左上，badge 显示 `EMPTY`。

**删除编排**：

- `CharacterCard.onDelete(id)` 触发 → 调 `deleteCharacter(id)` → 从内存列表 filter 该 id。
- CharacterCard 在被列表移除后自然 unmount，其内部 `useEffect` cleanup 自动 `URL.revokeObjectURL`（T4 已内化）。
- **本容器不维护 object URL 引用表**——T4 已确保 CharacterCard 自管，重复维护会双 revoke。
- 删除失败：`console.error` + 顶部红条错误提示「删除失败：{message}」，不上报。

**错误处理**：

- 列表加载失败：`console.error` + 顶部红条「加载角色列表失败：{message}」。
- 删除失败：同上结构。
- 错误条只在 `view === 'list'` 时渲染（create 态有自己的字段级错误，不复用顶部条）。
- 关闭抽屉（`open` 由 true → false）清掉 `deleteError`，避免下次打开仍残留。

**动效与布局**：

- 容器 `position: fixed`，左 0 顶 0，高 100vh，宽 `var(--sidebar-width)`（沿用 280px）。
- 进出动效：`transform: translateX(-100% → 0)` + `opacity: 0 → 1`，时长 `var(--motion-base)`（200ms），曲线 `var(--easing-standard)`（`cubic-bezier(0.2, 0, 0, 1)`）。
- 不渲染 backdrop / scrim：契约 minimal-refined，HistoryDrawer 当前也不带遮罩，加 scrim 会破坏一致性。
- z-index `20`，避免被主内容卡片遮挡。
- 关闭态下设 `aria-hidden="true"` + `tabIndex=-1`，阻挡 Tab 键进入；同时保持挂载以保留动效与内部 state。

**键盘**：

- 抽屉打开时全局监听 ESC → 触发 `onClose`；关闭时移除监听。
- 不做 focus trap（MVP 单用户，加 trap 是过度抽象——`:focus-visible` 已由全局 token 处理）。

**与父组件（T6）的协议**：

- 父组件持有「`openDrawer: 'none' | 'history' | 'characters'`」单值状态实现同侧互斥；把 `openDrawer === 'characters'` 传进 `open` 即可。
- `onClose` 通常实现为 `setOpenDrawer('none')`。
- 父组件**不需要**关心列表的拉取时机、object URL 释放、view 重置——CharacterDrawer 内化了这些生命周期。

## `NewCharacterCard`

**props**：

```ts
type NewCharacterCardProps = {
  onClick: () => void
}
```

- 渲染为 `<button>`，天然带键盘可达与 focus 态（焦点态走全局 `:focus-visible`）。
- 视觉上与普通角色卡尺寸一致（`aspect-ratio: 1 / 1`），用虚线边框 + 居中 `+` 与提示文案表达「入口而非内容」。
- hover 时切到 accent 软态（边框 + 文本 + 背景），与 PromptInput 上传入口同款语汇。
- **不负责**切抽屉态——父组件（`CharacterDrawer`）接 `onClick` 后调 `setView('create')` 切表单态。

## `CharacterCard`

**props**：

```ts
type CharacterCardProps = {
  character: Character
  onDelete: (id: string) => void
}
```

**渲染**：

- 默认态：1:1 主视觉区（参考图，`object-fit: cover`）+ 底部一行 Name 行；与 `NewCharacterCard` 共用 1:1 主视觉区保证网格对齐。
- 展开态：在默认态下方追加 INSTRUCTIONS 段（eyebrow + 文本，空时显示「未填写」斜体占位）+ 单按钮「删除」（与 `HistoryDetail.btnDanger` 同规格的危险描边按钮）。
- 删除确认态（展开态的子态）：「删除」按钮**就地**变为两个并排按钮 —— 「取消」（ghost）+「确认删除」（filled danger，hover 走 opacity 反馈不引入新色值）。

**展开 / 折叠**：

- 卡片头部（图 + Name 区）整体是单个 `<button>`，点击切换展开 / 折叠；带 `aria-expanded`。
- 折叠时同步把删除确认态重置（避免下次展开停在确认态）。
- **多卡可并存展开**：每张卡独立 `useState`，互不影响。

**删除二次确认（卡内内联变态）**：

1. 展开态点「删除」→ `setIsConfirmingDelete(true)`，按钮区原地变为「取消 | 确认删除」
2. 点「确认删除」→ 调用 `props.onDelete(id)`；本组件**不**碰 IDB（删除走外层 `CharacterDrawer.handleDelete`）
3. 点「取消」→ 回到普通展开态，按钮恢复为「删除」
4. 内层按钮点击都 `stopPropagation`，避免同时触发卡片折叠

**图片资源生命周期**：

- `useEffect` 监听 `character.image`：`URL.createObjectURL(image)` 设为 `<img src>`；cleanup 时 `URL.revokeObjectURL`
- 当 image Blob 引用变化（理论上不会，因为 MVP 不支持改图）也会重建并 revoke 旧 URL
- 组件 unmount 时统一 revoke，确保抽屉关闭 / 卡片删除后不残留 object URL

**与外层（`CharacterDrawer`）的协作约定**：

- 外层在 `onDelete` 回调里调 `deleteCharacter(id)` + 从列表 filter 即可：被 filter 掉的 CharacterCard 自然 unmount，自动触发其内部 revoke。
- 外层 **不需要** 持有 object URL 引用表——双重 revoke 会触发浏览器警告。

## `CharacterCreateForm`

**props**：

```ts
type CharacterCreateFormProps = {
  onCreated: (character: Character) => void
  onCancel: () => void
}
```

**数据通路**：

- 直接 import `../../storage/charactersDb` 的 `createCharacter` 与三个自定义错误类；**不**通过 hook 注入回调（保持组件可在任意上下文复用）。
- 父组件 `CharacterDrawer` 在 `onCreated` 回调里把新角色 prepend 到内存列表，并切回 `'list'` 态；`onCancel` 直接切回 `'list'`。本表单只保证 IDB 已落库 + 返回完整 `Character`。

**字段与校验**：

| 字段 | 必填 | UI 行为 | 错误文案触发条件 |
|---|---|---|---|
| 参考图 | ✅ | `<input accept="image/png,image/jpeg,image/webp">`；选中后内联预览（96×96 cover）+ 文件名 + 大小/MIME；可移除重选 | (1) 选择文件 onChange 时 MIME 不在白名单 → 拒收 + 提示；(2) 提交时仍未选 → 「请先选择一张参考图」；(3) 提交前 MIME 二次校验失败 → 「图片格式必须是 PNG / JPEG / WebP」；(4) 持久层抛 `InvalidImageError` → 同上 |
| Name | ✅ | 单行 `<input>`；变化时清空已有 nameError | (1) trim 后空 → 「Name 不能为空」（本地校验，**不**调持久层）；(2) 持久层抛 `EmptyNameError` → 同上；(3) 持久层抛 `DuplicateNameError` → 「Name 已存在，换一个试试」 |
| Instructions | ❌ | `<textarea>` 默认 4 行；trim 后空字符串不写入（持久层字段 `undefined`） | — |

**提交前的 MIME 二次校验**：`<input accept>` 在不同浏览器下并非强校验，且用户可拖入文件或选「显示所有文件」绕过。因此 `handleSubmit` 内在调 `createCharacter` 前显式判一次 `imageFile.type ∈ {png, jpeg, webp}`；持久层 `createCharacter` 内部也会再校验一次，构成双重保险。

**错误层次**：

- 字段级错误（nameError / imageError）：紧贴对应字段下方红条；用户修改对应字段时**不**自动清（只在 name onChange 时清 nameError；其他保留到下次 submit）。
- 表单级错误（formError）：所有「不属于已知三类错误」的失败（如 IDB 写入异常）走这里，渲染在底部操作行之上。

**预览生命周期**：

- 选图 → `useEffect` 监听 `imageFile`，新建 `URL.createObjectURL`，把上一份 revoke
- 卸载 / 取消 / 提交成功 → useEffect cleanup 自动 revoke
- 严格遵守「createObjectURL 必须 revokeObjectURL」原则，避免长期开抽屉造成内存累积

**视觉细节**（落在裁量权内的实现选择）：

- 表单不再包一层卡片，直接铺在抽屉内容区（抽屉本身就是 `--color-surface`），通过 `space-4` 间隔区分字段
- 「过大图片会拖慢加载」放在底部操作行之上，用 `--font-mono` + `--color-text-faint` 表达「非阻断的软提示」，不抢主路径焦点
- 主 CTA「创建」用 fill accent；「取消」用 surface + border 的次级按钮，左右等宽并排（`flex: 1`）确保抽屉窄宽度下也不会挤
- 「Name *」星号用 accent 色而非 danger 色，与全站把 danger 仅用于错误/删除的语义保持一致

**状态隔离**：

- 取消 / 提交成功后 `resetForm` 清空所有内部状态，包括清掉 `<input type="file">.value`（确保用户能再次选择同一文件触发 change）。
- 本组件不持有任何抽屉态；父组件可放心地用 `key` 重挂或 unmount 都不会丢任何持久化数据（数据已在 IDB）。

## CSS Module 约定

- 文件命名：`<Component>.module.css`，与 `<Component>.tsx` 同名同目录。
- 颜色 / 字号 / 间距 / radius / shadow / motion **必须**消费 `:root` tokens（定义在 `frontend/src/index.css`）；本目录禁止裸值。
- focus 态走全局 `:focus-visible`（在 `index.css` 已定义 `box-shadow: var(--shadow-focus)`），组件层不要重复定义。

## 与持久层的依赖

| 依赖 | 来源 | 用途 |
|---|---|---|
| `listCharacters()` | `frontend/src/storage/charactersDb.ts` | `CharacterDrawer` 抽屉首次打开拉列表 |
| `createCharacter({ name, instructions?, image })` | 同上 | 表单提交时写 IDB |
| `deleteCharacter(id)` | 同上 | `CharacterDrawer` 删除编排 |
| `EmptyNameError` / `DuplicateNameError` / `InvalidImageError` | 同上 | 三类校验失败的 `instanceof` 分支 |
| `Character` 类型 | 同上 | 跨组件 props 类型对齐 |

> 注：`useCharacters` hook 由持久层一并导出，但本 cycle 的抽屉容器选择不消费它——理由是 hook 的「挂载即拉」与「抽屉关闭后再次打开重置 list 态」需求耦合不干净，容器层手控 list state 更直接。hook 仍作为对外契约保留，后续若有别处需要"挂载即响应"列表可直接用。
