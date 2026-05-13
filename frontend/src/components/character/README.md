# components/character/

Characters 页 grid 卡片三件套（从原 `components/CharacterDrawer/` 平提）。

## 组件清单

### `CharacterCard.tsx`
角色展示卡。
- 默认态：方形主视觉，参考图 `object-fit: cover` 满铺，底部黑→透明渐变叠层 + 左下角 Name。
- 展开态：自身 `grid-row: span 2`，向下纵向抽高占两行；下半行渲染 Instructions + 删除操作。同行其它卡不动，下方行整体下移（CSS grid 自然重排），不打断布局、不遮盖其他卡。
- 删除二次确认：单按钮「删除」点击后就地变态为「取消 | 确认删除」并排按钮；折叠时一并重置确认态。
- 不直接操作 IDB：`onDelete(id)` 通过 props 上抛由 `CharactersPage` 处理。
- 资源管理：`URL.createObjectURL(image)` 渲染参考图，image Blob 引用变化或卸载时 `revokeObjectURL`。

Props：
```ts
type CharacterCardProps = {
  character: Character
  onDelete: (id: string) => void
}
```

### `NewCharacterCard.tsx`
grid 首位的「新建角色」占位卡。
- 浅色 `surface-muted` 背景 + 虚线边框 + `+` icon + `New Character` / `Create your own` 双行文案。
- 自身 `aspect-ratio: 1 / 1`，与 `CharacterCard` 默认态尺寸一致。
- 点击直接 `navigate('/characters/new')`，不再依赖外部 `openDrawer` 状态。

Props：无（自包含 `useNavigate`）。

### `CharacterCreateForm.tsx`
角色创建表单（字段与提交逻辑沿用，未改动）。
- 字段：参考图（PNG/JPEG/WebP）+ Name + Instructions（可选）。
- 直接调用 `storage/charactersDb.createCharacter`；三类校验错误（`EmptyNameError` / `DuplicateNameError` / `InvalidImageError`）映射到字段错误文案。
- 预览图 `URL.createObjectURL` + 卸载/换图 revoke。
- `onCreated(character)` / `onCancel()` 由父组件决定下一步——在 `CharactersPage` 里这两个回调都 `navigate('/characters')`。

Props：
```ts
type CharacterCreateFormProps = {
  onCreated: (character: Character) => void
  onCancel: () => void
}
```

## 与父页面的协议

`CharactersPage`：
- grid `auto-fill minmax(260px, 1fr)`；首位 `<NewCharacterCard />`，其后是真实角色卡。
- `pathname === '/characters/new'` 时在 grid 下方渲染 `<CharacterCreateForm>` 面板；提交成功 / 取消都 `navigate('/characters')`，触发面板卸载。

## 视觉契约

沿用 `.cadence/PROJECT.md` 视觉契约：minimal-refined / 浅色 / 冷色系 / 单一冷蓝 accent / 无衬线。所有颜色 / 字号 / 间距 / radius / motion 走 `:root` tokens。
