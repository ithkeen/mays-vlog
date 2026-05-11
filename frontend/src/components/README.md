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
| `HistoryDrawer.tsx` / `.module.css` | 历史菜单**占位组件**（T11 范围内只渲染占位文案，T12 会替换为真实历史列表） |

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

整个右侧主工作区的容器：

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

## `HistoryDrawer`（占位）

T11 不做历史菜单逻辑——本组件目前只渲染一段「历史 / EMPTY / 历史列表将在 T12 接入」占位。抽成独立组件是为了 T12 实现时**只改 `HistoryDrawer.tsx`**，不必触碰 `App.tsx`。
