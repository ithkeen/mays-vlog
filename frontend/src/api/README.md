# `frontend/src/api/`

后端 HTTP API 客户端 + React 数据 hook。供 T11 主界面与 T12 历史菜单使用。

## 文件清单

| 文件 | 职责 |
|---|---|
| `client.ts` | 6 个端点的 fetch 封装 + 类型契约 + `ApiError` 类 |
| `hooks.ts` | `useTaskPolling`（5s 轮询）+ `useSubmitTask`（提交状态机） |

## 与后端契约（T7）的对齐

字段命名一律按后端原样保留（snake_case），**不**做前端口味改名：

- POST 请求体图片字段是 `image: string \| null`（**不是 `image_base64`**），值是 raw base64，无 `data:` 前缀。
- 列表 / 详情响应中：`has_image`、`created_at`、`finished_at`、`error_message` 等字段全为 snake_case。
- 时间是 unix **秒**（number），不是毫秒，也不是 ISO 字符串。前端写入 IndexedDB 前自行 ×1000。
- 状态枚举：`'pending' | 'running' | 'success' | 'failure'`。
- `current_task_id` 在 POST 200 响应里也会带（来自 T6 的 `submit_task` 透传）；409 体里也有，用于错误提示。

## `client.ts` 函数

所有函数遇到 4xx/5xx 抛 `ApiError`；网络/解析错原样向上抛 Error，调用方应自行兜底。

| 函数 | 端点 | 说明 |
|---|---|---|
| `submitTask(prompt, image)` | POST `/api/tasks` | 提交任务；`image` 传 raw base64 或 null。返回 `{ id, status: 'pending', current_task_id }`。409 时抛 `ApiError(code='task_in_progress', currentTaskId=...)` |
| `listTasks()` | GET `/api/tasks` | 仅 success 历史，按 `finished_at` 倒序（顺序由后端保证） |
| `getTask(id)` | GET `/api/tasks/{id}` | 单任务详情（用于轮询） |
| `getPlayUrl(id)` | GET `/api/tasks/{id}/play_url` | 仅 success 任务可用；返回签名 URL + 有效期秒 |
| `updateTaskTitle(id, title)` | PATCH `/api/tasks/{id}` | 重命名 |
| `deleteTask(id)` | DELETE `/api/tasks/{id}` | 删除；返回 204 → void |

## `ApiError`

```ts
class ApiError extends Error {
  code: string;          // 来自后端 body.error；解析不出来时 fallback 到 statusText 或 'http_error'
  status: number;        // HTTP 状态码（网络错为 0）
  currentTaskId?: string; // 仅 409 + code='task_in_progress' 时有值
}
```

调用约定：

- 上层用 `if (err instanceof ApiError) ...` 区分。
- 409 时根据 `err.code === 'task_in_progress'` 显示"已有任务在跑（id: ${err.currentTaskId}）"提示。

## `useTaskPolling(taskId, enabled)`

- `enabled` 为真且 `taskId` 非空时，立刻拉一次 + 每 5 秒拉一次 `getTask(taskId)`。
- 命中 `success` / `failure` 终态 → 自动停定时器；后续即使 `enabled` 仍为真也不会再拉。
- 卸载 / `enabled` 变 false / `taskId` 变化 → 清定时器；切换 taskId 时清掉旧详情防错配。
- 返回 `{ task, error, isLoading }`：`task` 是最近一次成功响应的详情；`error` 是最近一次失败的 `ApiError`，下一次成功会清回 null。

## `useSubmitTask()`

状态机：

```
idle ──submit()──▶ submitting ──POST 200──▶ running ──polling success──▶ success
                                                     └──polling failure─▶ failure
                                  └──POST 4xx/5xx────────────────────────▶ failure
```

返回：

```ts
{
  status: 'idle' | 'submitting' | 'running' | 'success' | 'failure',
  taskId: string | null,        // POST 200 后赋值
  task: TaskDetail | null,      // 来自内部 useTaskPolling
  error: ApiError | null,       // 提交错或任务终态 failure 时的错误
  submit: (prompt: string, imageBase64?: string) => Promise<void>,
}
```

注意：

- **前端在提交时不传 title**——title 通过单独的 `updateTaskTitle` (PATCH) 设置。
- 任务终态 `failure` 时，`error` 是 `ApiError(code='task_failed', message=后端 error_message)`，便于 UI 直接显示文案。
- 提交 409（in-flight 锁占用）走的是 `submitting → failure` 路径，`error.code === 'task_in_progress'`，`error.currentTaskId` 可读。

## 使用示例

```tsx
const { status, error, submit, task } = useSubmitTask();

// 文生
await submit('一只在沙滩上奔跑的金毛');

// 图生
await submit('让画里的人物笑起来', someBase64);

if (status === 'success' && task) {
  // 拿播放 URL
  const { url } = await getPlayUrl(task.id);
  // <video src={url} controls />
}

if (status === 'failure' && error?.code === 'task_in_progress') {
  // 已有任务在跑：error.currentTaskId
}
```
