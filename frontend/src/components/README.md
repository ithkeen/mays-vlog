# `frontend/src/components/`

UI 组件层。所有组件用 CSS Modules（`*.module.css`），颜色 / 间距 / 字号统一消费 `:root` 中的 design tokens（见 `src/index.css` 与 `frontend/README.md`）。

视觉契约（DESIGN.md 锁定）：minimal-refined、浅色、冷色系、单一冷蓝 accent、无衬线。组件层不引入第二个色相、不引入 dark mode 切换。

## 文件清单

| 文件 | 职责 |
|---|---|
| `PromptInput.tsx` / `.module.css` | prompt textarea + 可选首帧图上传 + 主提交按钮（提交时不传 title） |
| `ProgressPanel.tsx` / `.module.css` | 「生成中」spinner 条幅 / 失败提示条幅（含 409 in-flight 文案） |
| `VideoPlayer.tsx` / `.module.css` | success 终态的 `<video controls>` + 「再生成一个」入口 |
| `SubmissionWorkspace.tsx` / `.module.css` | 编排上面 3 个组件 + `useSubmitTask`，覆盖完整的 idle/submitting/running/success/failure 生命周期 |
| `HistoryDrawer.tsx` / `.module.css` | 左侧历史菜单（T12 真实实现）：列表 / 选中态 / 相对时间 / IMG 标记 |
| `HistoryDetail.tsx` / `.module.css` | 右侧历史详情（T12）：prompt 全文 + 视频 + 首帧图 + 下载 / 重命名 / 删除 |
| `CharacterDrawer/` | Character 库抽屉子组件目录；与 HistoryDrawer 同侧互斥，独立子目录便于隔离演化。详见 [`CharacterDrawer/README.md`](CharacterDrawer/README.md) |

## 主工作区两态切换

`App.tsx` 持有 `selectedId: string | null` 状态：

- `selectedId === null` → 右侧渲染 `<SubmissionWorkspace>`（用户提交流，T11）
- `selectedId !== null` → 右侧渲染 `<HistoryDetail itemId={selectedId} />`（历史详情，T12）

切换由 `<HistoryDrawer onSelect={...}>` 的列表点击触发；`<HistoryDetail>` 内部删除成功后调 `onDeleted` 让父级把 `selectedId` 复位为 `null`。

## `PromptInput`

- props：`onSubmit(payload)` / `disabled` / `submitLabel`。
- 文件校验：仅 `image/png` / `image/jpeg`（兼容浏览器偶尔上报的 `image/jpg`，归一化为 `image/jpeg`）；尺寸 ≤ 10MB。
- base64 处理：`FileReader.readAsDataURL` 读出后用 `string.indexOf(',')` 切掉 `data:image/...;base64,` 前缀，**仅**把后半截传给父级；同时把规范化后的 MIME 类型一并向上传递（`image/png` 或 `image/jpeg`）。
- 移除按钮：清空 base64/MIME/文件名/错误，并清空隐藏的 `<input type="file">`.value，确保用户可以再次选择**同一文件**触发 change。
- prompt 校验：trim 后非空才允许提交；UI 层用 `maxLength={2500}` + 字符计数硬卡；空字符串时主按钮 disabled。
- 主按钮 = 唯一 accent CTA（fill = `--color-accent`）；disabled 时 opacity 降到 0.55。

`onSubmit` 的 payload 形状：

```ts
type PromptInputSubmitPayload = {
  prompt: string;                                    // 已 trim
  imageBase64: string | null;                        // raw base64，无 data: 前缀
  imageMimeType: 'image/png' | 'image/jpeg' | null;  // 与 imageBase64 同步在场 / 同步缺席
};
```

## `ProgressPanel`

- 只渲染两种态：`submitting | running` → spinner + 文案；`failure` → 红色错条。
- `idle | success` 不挂载（success 时父级切到 `VideoPlayer`，本组件不出现）。
- 409（`error.code === 'task_in_progress'`）时显示「当前已有任务运行 (id: …)」，使用 `error.currentTaskId`。
- 一般 failure 显示 `error.message`（`useSubmitTask` 在 polling 拿到 `failure` 时把 `error_message` 包成 `ApiError(code='task_failed')`，本组件直接渲染 message）。
- spinner：`@keyframes prog-spin`（800ms 线性循环），无外部库；非阻塞，不遮挡输入区。

## `VideoPlayer`

- props：`url: string | null`、`onNewSubmission: () => void`、`fallbackMessage?`。
- url 就绪 → `<video src={url} controls />`，max-height 70vh，黑底（视频质感）。
- url 为 null → 渲染 fallback 文案；仍然提供「再生成一个」按钮，避免用户卡死。
- 「再生成一个」由父级 `SubmissionWorkspace` 通过自增 key 触发 remount，把状态机重置回 idle。

## `SubmissionWorkspace`

整个右侧主工作区在「未选历史」分支下的容器：

1. 持有 `useSubmitTask()`（idle / submitting / running / success / failure 状态机）。
2. success 终态 `useEffect`：
   - 调一次 `getPlayUrl(task.id)` → 喂给 `<VideoPlayer>`
   - 把 `HistoryItem` 写入 IndexedDB `putMany([...])`，包含：
     - `createdAt = task.created_at * 1000`、`finishedAt = task.finished_at * 1000`（**unix 秒 → 毫秒** 强制换算）
     - 若提交时上传过图，写入 `imageBase64` + `imageMimeType`
   - 用 `useRef` 卫住「同一 task.id 不重复写库」（兼容 React 18 strict mode 双触发）
3. failure 终态：**不**写 IndexedDB（与 acceptance / REQUIREMENT 一致）；继续展示 `<PromptInput>`，用户可立即修改后再次提交。
4. 「再生成一个」：调父级 `onResetRequested` → 父级自增 `key` → 本组件 remount → 状态回 idle。

`SubmissionWorkspaceProps`：

```ts
type SubmissionWorkspaceProps = {
  onResetRequested: () => void;
};
```

## `HistoryDrawer`（T12）

左侧历史列表的真实实现。

**props**：

```ts
type HistoryDrawerProps = {
  selectedId: string | null;          // App 当前选中的历史 id；用于高亮当前项
  onSelect: (id: string) => void;     // 列表项点击回调（App 据此切换右侧到 HistoryDetail）
  refreshTick: number;                // 父级递增后强制重做「listTasks → mergeFromBackend → getAll」
};
```

**数据源 & 同步策略**：

- mount 与每次 `refreshTick` 变化：`listTasks()` → `mergeFromBackend()` → `getAll()`，以后端为权威。
- 5 秒一次轻量本地 `getAll()`：让 `SubmissionWorkspace` 直接写入 IDB 的新条目自动出现在列表里（成本可忽略）。
- 后端不可达时降级：仍展示本地缓存，并在头部以红条提示同步失败原因；保证离线 / 后端宕机不会清空已有列表。
- 排序由 `historyDb.getAll()` 在 IndexedDB 索引侧保证（按 `finishedAt` DESC）。

**展示规则**：

- 标题：`item.title || item.prompt`，trim 后超过 40 字截断 + `…`。
- 相对时间：基于 `Intl.RelativeTimeFormat('zh-CN', {numeric:'auto'})`；秒/分/时/天/月/年 阶梯；每 60 秒重算一次。
- 图生路径以 `IMG` 小标记呈现（`item.hasImage === true`）。
- 当前选中的列表项使用 `accent-soft` 背景 + 强 border 表达 active 态。
- 空列表态：友好引导文案，不显示假数据。

**当前正在生成中的任务不出现**：因为后端 `GET /api/tasks` 只返 success，`mergeFromBackend` 自然不会插非 success；本组件无需特殊判定。

## `HistoryDetail`（T12）

右侧主工作区在「已选历史」分支下的详情视图。

**props**：

```ts
type HistoryDetailProps = {
  itemId: string;                                       // 当前要展示的历史 task id
  onDeleted: (id: string) => void;                      // 删除成功后通知父级（清空 selectedId + bump refresh）
  onRenamed: (id: string, newTitle: string) => void;    // 重命名成功后通知父级（让左栏 merge 后端列表）
};
```

**渲染**：

- 顶部：`HISTORY DETAIL` eyebrow + 标题（`title || prompt[:40]`）+ 操作栏（下载 / 重命名 / 删除）
- 视频：`<video controls>`，src 是首次 mount 拉的 `play_url`
- prompt 全文卡片
- 首帧图卡片：仅 `hasImage === true && imageBase64` 在场时渲染 `<img src="data:${mime};base64,${b64}">`（`mime` 缺失时兜底 `image/png`）。`hasImage === true` 但本地没图字节（例如其他设备 / 清缓存后再 merge 而来）时显示一行说明文字而不是空白。

**操作**：

| 操作 | 行为 |
|---|---|
| 下载 | 每次点击都重新调 `getPlayUrl(id)`（避免旧 url 过期），创建临时 `<a href={url} download="${title \|\| prompt[:40]}.mp4">`，触发 `click` 后从 DOM remove |
| 重命名 | 行内编辑：标题位置切换为 `<input>` + 保存 / 取消按钮；Enter 提交、Esc 取消；成功后 `updateTaskTitle` + `historyDb.updateTitle` + `onRenamed` |
| 删除 | `window.confirm` 二次确认（文案带当前标题）；确认后 `deleteTask` + `historyDb.remove` + `onDeleted` |

**错误处理**：

- 各操作失败展示独立红条；不静默吞错。
- 任何一个操作失败都不阻塞用户尝试别的操作（删除失败时按钮恢复 enabled）。
- `play_url` 失败：视频区域显示 fallback 文案，但其他操作仍可用。

**生命周期**：

- 每次 `itemId` 变化（即 App 用 `key={selectedId}` remount）→ 重新读 IDB + 重拉 `play_url` + 重置所有局部 state。

## 视觉契约消费规则

| Token | 用途 |
|---|---|
| `--color-accent` | 主 CTA fill（生成视频按钮、保存按钮）、HISTORY DETAIL eyebrow、focus ring、状态指示 dot |
| `--color-accent-soft` | 选中历史项的背景 |
| `--color-accent-hover` | accent 按钮 hover |
| `--color-danger` / `--color-danger-soft` | 删除按钮 hover、错误条 |
| `--color-surface` / `--color-surface-muted` | 卡片 / 次表面（按钮 / fallback 区） |
| `--color-border` / `--color-border-strong` | 主分割 / 选中态 border |
| `--color-text` / `--color-text-muted` / `--color-text-faint` | 三级文本层级 |
| `--font-mono` | 计数 / eyebrow / IMG 标记等结构性短文 |
| `--font-sans` | 一切正文 |
| `--space-1..8` / `--radius-sm..lg` / `--shadow-sm..md` / `--motion-fast/base` | spacing / radius / shadow / motion |

组件层 **禁止**直接写颜色字面量、字号 px、间距 px；新增样式一律走 token。
