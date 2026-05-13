# pages/

一级页面组件。每个页面对应路由表中的一条 path。由 `components/AppShell/AppShell.tsx` 统一挂载。

## 页面清单

| 文件 | 路由 | keep-mounted | 备注 |
|---|---|---|---|
| `GeneratePage.tsx` | `/generate` | 是 | 默认入口。后续 task 集成现有 `SubmissionWorkspace` |
| `HistoryPage.tsx` | `/history` | 是 | 历史网格列表。后续 task 接入 `useHistoryList` + `HistoryCard` |
| `HistoryDetailPage.tsx` | `/history/:id` | 否 | 独立详情页，随 URL mount/unmount |
| `CharactersPage.tsx` | `/characters`、`/characters/new` | 是 | 列表 + 创建表单态共用；由 pathname 切换 |

## T1 阶段

每个 page 当前仅渲染 `<PageHeader title="...">` 占位以跑通路由骨架。实际内容留给本 cycle 后续 task（T3+）。
