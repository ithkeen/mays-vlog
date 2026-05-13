# `frontend/src/components/`

UI 组件层。所有组件用 CSS Modules（`*.module.css`），颜色 / 间距 / 字号统一消费 `:root` 中的 design tokens（见 `src/index.css` 与 `frontend/README.md`）。

视觉契约（DESIGN.md 锁定）：minimal-refined、浅色、冷色系、单一冷蓝 accent、无衬线。组件层不引入第二个色相、不引入 dark mode 切换。

## 顶层文件清单

| 文件 / 子目录 | 职责 |
|---|---|
| `AppShell/` | 应用外壳：两列 grid（Sidebar + 主区）+ Generate / History / Characters 三 page keep-mounted + 路由派发。详见 [`AppShell/README.md`](AppShell/README.md) |
| `character/` | Characters 页 grid 卡片三件套（CharacterCard / NewCharacterCard / CharacterCreateForm）。详见 [`character/README.md`](character/README.md) |
| `history/` | History 模块展示组件（HistoryCard / HistoryDetail）。详见 [`history/README.md`](history/README.md) |
| `PromptInput.tsx` / `.module.css` | prompt textarea + 可选首帧图上传 + 主提交按钮（提交时不传 title） |
| `ProgressPanel.tsx` / `.module.css` | 「生成中」spinner 条幅 / 失败提示条幅（含 409 in-flight 文案） |
| `VideoPlayer.tsx` / `.module.css` | success 终态的 `<video controls>` + 「再生成一个」入口 |
| `SubmissionWorkspace.tsx` / `.module.css` | 编排上面 3 个组件 + `useSubmitTask`，覆盖完整的 idle/submitting/running/success/failure 生命周期；由 `pages/GeneratePage.tsx` 消费 |

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

进度可见性仅落在 GeneratePage 内：sidebar / PageHeader / 其他页面均不出现全局进度提示。

## `VideoPlayer`

- props：`url: string | null`、`onNewSubmission: () => void`、`fallbackMessage?`。
- url 就绪 → `<video src={url} controls />`，max-height 70vh，黑底（视频质感）。
- url 为 null → 渲染 fallback 文案；仍然提供「再生成一个」按钮，避免用户卡死。
- 「再生成一个」由父级 `SubmissionWorkspace` 通过自增 key 触发 remount，把状态机重置回 idle。

## `SubmissionWorkspace`

GeneratePage 内承载提交流程的容器：

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

## 视觉契约消费规则

| Token | 用途 |
|---|---|
| `--color-accent` | 主 CTA fill（生成视频按钮、保存按钮）、HISTORY DETAIL eyebrow、focus ring、状态指示 dot |
| `--color-accent-soft` | 选中态背景 |
| `--color-accent-hover` | accent 按钮 hover |
| `--color-danger` / `--color-danger-soft` | 删除按钮 hover、错误条 |
| `--color-surface` / `--color-surface-muted` | 卡片 / 次表面（按钮 / fallback 区） |
| `--color-border` / `--color-border-strong` | 主分割 / 选中态 border |
| `--color-text` / `--color-text-muted` / `--color-text-faint` | 三级文本层级 |
| `--font-mono` | 计数 / eyebrow / IMG 标记等结构性短文 |
| `--font-sans` | 一切正文 |
| `--space-1..8` / `--radius-sm..lg` / `--shadow-sm..md` / `--motion-fast/base` | spacing / radius / shadow / motion |

组件层 **禁止**直接写颜色字面量、字号 px、间距 px；新增样式一律走 token。
