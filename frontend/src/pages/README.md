# pages/

一级页面组件。每个页面对应路由表中的一条 path。由 `components/AppShell/AppShell.tsx` 统一挂载。

## 页面清单

| 文件 | 路由 | keep-mounted | 备注 |
|---|---|---|---|
| `GeneratePage.tsx` | `/generate` | 是 | 默认入口。`<PageHeader title="Generate">` + `<SubmissionWorkspace>`；用 `resetKey` state 自增触发 remount 实现「再生成一个」 |
| `HistoryPage.tsx` | `/history` | 是 | 历史网格列表。后续 task 接入 `useHistoryList` + `HistoryCard` |
| `HistoryDetailPage.tsx` | `/history/:id` | 否 | 独立详情页，随 URL mount/unmount |
| `CharactersPage.tsx` | `/characters`、`/characters/new` | 是 | 列表 + 创建表单态共用；由 pathname 切换 |

## 进度可见性约束

生成进度（提交中 / 轮询中 / 失败）仅在 GeneratePage 内的 `ProgressPanel` 中展示——不在 sidebar / PageHeader / 其他页面以全局形式重复出现。切到 History / Characters 时，AppShell 用 `display:none` 保活 GeneratePage，`SubmissionWorkspace` 内部状态机和 `useTaskPolling` 的 5 秒轮询不被打断；切回 Generate 即可看到当前任务的最新进度。

## 待集成

`HistoryPage` / `HistoryDetailPage` / `CharactersPage` 当前仅 `<PageHeader>` 占位，实际内容由后续 task 填充。
