# pages/

一级页面组件。每个页面对应路由表中的一条 path。由 `components/AppShell/AppShell.tsx` 统一挂载。

## 页面清单

| 文件 | 路由 | keep-mounted | 备注 |
|---|---|---|---|
| `GeneratePage.tsx` | `/generate` | 是 | 默认入口。`<PageHeader title="Generate">` + `<SubmissionWorkspace>`；用 `resetKey` state 自增触发 remount 实现「再生成一个」 |
| `HistoryPage.tsx` | `/history` | 是 | 历史网格列表。mount 时 `listTasks → mergeFromBackend → getAll`，5 秒轻量本地 `getAll` 轮询保证 SubmissionWorkspace 新写入条目能出现；`auto-fill minmax(280px, 1fr)` grid，卡片用 `<HistoryCard>`；空态显示引导去 Generate 的 CTA；后端不可达时降级仅展示本地 + 红条提示 |
| `HistoryDetailPage.tsx` | `/history/:id` | 否 | 独立详情页。`useParams().id` → 先去 IDB 预查存在性；不存在时显示「未找到该作品」+ 返回 CTA，不抛异常、不跳回；存在时渲染 `<HistoryDetail>`；PageHeader 标题位置渲染面包屑（`<` 返回按钮 + `History` 链接 + 当前标题），点击 `<` 或 `History` 返回 `/history`；删除成功后 `navigate('/history')` |
| `CharactersPage.tsx` | `/characters`、`/characters/new` | 是 | grid 卡片列表（首位 `NewCharacterCard` + 真实角色卡）；`/characters/new` 时在 grid 下方渲染 `CharacterCreateForm` 面板，提交成功 / 取消都 navigate 回 `/characters` |

## 进度可见性约束

生成进度（提交中 / 轮询中 / 失败）仅在 GeneratePage 内的 `ProgressPanel` 中展示——不在 sidebar / PageHeader / 其他页面以全局形式重复出现。切到 History / Characters 时，AppShell 用 `display:none` 保活 GeneratePage，`SubmissionWorkspace` 内部状态机和 `useTaskPolling` 的 5 秒轮询不被打断；切回 Generate 即可看到当前任务的最新进度。
