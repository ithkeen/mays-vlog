# `frontend/src/components/CharacterDrawer/`

Character 库抽屉的 UI 组件集合。本目录承担 Character 库 cycle 引入的所有视图层，与现有 `HistoryDrawer.tsx`（位于上一级目录）同侧但互斥，互不耦合。

视觉契约（PROJECT.md 锁定）：minimal-refined / 浅色 / 冷色系 / 单一冷蓝 accent（`#1d4ed8`）/ 无衬线（IBM Plex Sans）。本目录所有 CSS 一律走 `:root` design tokens，不写裸色值 / 裸字号。

## 子组件职责矩阵

| 文件 | 职责 | 当前状态 |
|---|---|---|
| `CharacterDrawer.tsx` / `.module.css` | 抽屉根容器：维护「列表 / 创建表单」两态切换；与 HistoryDrawer 同侧互斥由父组件控制 | 待 T5 实现 |
| `CharacterCard.tsx` / `.module.css` | 列表态下的角色卡片：参考图 + Name + 展开内联 Instructions + 删除二次确认 | T4 已交付 |
| `NewCharacterCard.tsx` / `.module.css` | 网格首格的「新建角色」占位卡；点击触发 `onClick` 由外部决定如何切态 | T3 已交付 |
| `CharacterCreateForm.tsx` / `.module.css` | 创建表单：图片上传 + Name + Instructions + 创建 / 取消；直连持久层 `createCharacter` | T3 已交付 |

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
- **不负责**切抽屉态——父组件（`CharacterDrawer`，T5）接 `onClick` 后切表单态。

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
2. 点「确认删除」→ 调用 `props.onDelete(id)`；本组件**不**碰 IDB（删除走外层 `useCharacters().remove` 或同等）
3. 点「取消」→ 回到普通展开态，按钮恢复为「删除」
4. 内层按钮点击都 `stopPropagation`，避免同时触发卡片折叠

**图片资源生命周期**：

- `useEffect` 监听 `character.image`：`URL.createObjectURL(image)` 设为 `<img src>`；cleanup 时 `URL.revokeObjectURL`
- 当 image Blob 引用变化（理论上不会，因为 MVP 不支持改图）也会重建并 revoke 旧 URL
- 组件 unmount 时统一 revoke，确保抽屉关闭 / 卡片删除后不残留 object URL

**与外层（T5 `CharacterDrawer` / `useCharacters`）的协作约定**：

- 外层在 `onDelete` 回调里调 `useCharacters().remove(id)` 即可：hook 内部已经做了「IDB 删 + 内存列表过滤」乐观刷新
- 外层 **不需要** 关心 object URL 释放，CharacterCard 自己处理

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
- 父组件若用 `useCharacters` 管列表：在 `onCreated` 回调里调一次 `refresh()`，或自己 prepend 进列表；本表单只保证 IDB 已落库 + 返回完整 `Character`。

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
| `createCharacter({ name, instructions?, image })` | `frontend/src/storage/charactersDb.ts` | 表单提交时写 IDB |
| `EmptyNameError` / `DuplicateNameError` / `InvalidImageError` | 同上 | 三类校验失败的 `instanceof` 分支 |
| `Character` 类型 | 同上 | `onCreated` 回调入参类型 |

后续 T4 / T5 组件还会消费 `listCharacters` / `deleteCharacter` 或 `useCharacters` hook，按各自 task 的范围引入即可。
