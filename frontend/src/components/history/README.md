# `components/history/`

History 模块的展示组件，由 `pages/HistoryPage.tsx` 与 `pages/HistoryDetailPage.tsx` 消费。

视觉契约沿用 `:root` tokens（minimal-refined / 浅色 / 冷色 / 单一 accent / IBM Plex Sans）。

## 文件清单

| 文件 | 职责 |
|---|---|
| `HistoryCard.tsx` / `.module.css` | History 列表的 grid 卡：视频首帧满铺背景 + 底部渐变叠层 + 标题 + 相对时间；点击进详情 |
| `HistoryDetail.tsx` / `.module.css` | 详情视图：大播放器 + 标题 / 操作栏（下载 / 重命名 / 删除）+ prompt + 首帧图 |

## `HistoryCard`

**props**：

```ts
type HistoryCardProps = { item: HistoryItem };
```

**首帧获取**：通过 `usePlayUrlPool([item.id])` 拿 `play_url`（最多 6 并发，1h 缓存，单项失败不阻塞其他）。拿到 URL 后挂 `<video preload="metadata" muted playsInline>`，`onLoadedMetadata` 时把 `currentTime = 0.1` 触发首帧渲染。

**失败兜底**：

- `usePlayUrlPool` 返回 `status === 'error'` → 媒体区背景退化为 `--color-surface-muted` 纯色占位
- `<video>` 触发 `onError`（链接过期、metadata 加载失败等）→ 同样退化为占位
- 两种失败下，**标题与时间正常显示，卡片仍可点击**进入 `/history/{id}`

**展示**：

- 卡片宽度 = grid 列宽，媒体区 `aspect-ratio: 16/9` 满铺
- 底部 45% 高度的线性渐变叠层（透明 → `rgba(15,23,42,0.55)`）保证白字在视频上的可读性
- 标题：`item.title || item.prompt`，单行省略
- 时间：`Intl.RelativeTimeFormat('zh-CN', {numeric:'auto'})`，每分钟重算

**交互**：

- 整张卡是 `<button>`，点击 → `navigate('/history/${id}')`
- focus-visible 显示 accent ring；hover 略微抬升 + 强 border

## `HistoryDetail`

由 `HistoryDetailPage` 在 `/history/:id` 路由命中时 mount，URL 切走时 unmount。

**props**：

```ts
type HistoryDetailProps = {
  itemId: string;
  onDeleted: (id: string) => void;
  onRenamed: (id: string, newTitle: string) => void;
};
```

**渲染**：

- 顶部：`HISTORY DETAIL` eyebrow + 标题（`title || prompt[:40]`）+ 操作栏（下载 / 重命名 / 删除）
- 视频：`<video controls>`，src 是首次 mount 拉的 `play_url`
- prompt 全文卡片
- 首帧图卡片：仅 `hasImage === true && imageBase64` 在场时渲染 `<img src="data:${mime};base64,${b64}">`；`hasImage === true` 但本地无图字节时显示一行说明文字

**操作**：

| 操作 | 行为 |
|---|---|
| 下载 | 每次点击都重新调 `getPlayUrl(id)`（避免旧 url 过期），创建临时 `<a href={url} download="${title \|\| prompt[:40]}.mp4">`，触发 `click` 后从 DOM remove |
| 重命名 | 行内编辑：标题位置切换为 `<input>` + 保存 / 取消按钮；Enter 提交、Esc 取消；成功后 `updateTaskTitle` + `historyDb.updateTitle` + `onRenamed` |
| 删除 | `window.confirm` 二次确认（文案带当前标题）；确认后 `deleteTask` + `historyDb.remove` + `onDeleted` |

**错误处理**：

- 各操作失败展示独立红条；不静默吞错
- 任何一个操作失败都不阻塞用户尝试别的操作
- `play_url` 失败：视频区域显示 fallback 文案，但其他操作仍可用

**生命周期**：

- 每次 `itemId` 变化 → 重新读 IDB + 重拉 `play_url` + 重置所有局部 state
- 由 `HistoryDetailPage` 提供 `onDeleted` / `onRenamed`：删除成功后页面 `navigate('/history')`，重命名后页面更新面包屑
