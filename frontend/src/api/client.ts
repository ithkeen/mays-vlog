/**
 * 后端 HTTP API 客户端。封装 T7 暴露的 6 个端点，类型严格对齐 DESIGN「接口设计」。
 *
 * 字段命名注意：
 * - POST 请求体的图片字段是 `image`（不是 `image_base64`），值为 raw base64（无 `data:` 前缀）。
 * - 列表 / 详情字段是 snake_case（`has_image` / `created_at` / `finished_at`），时间为 unix 秒（number）。
 * - 详情中 `finished_at` 在非终态时为 null；列表只返回 success 任务，`finished_at` 必为 number。
 *
 * 所有请求都走 Vite 代理 `/api` → `http://localhost:8000`（见 vite.config.ts）。
 *
 * 错误归一：4xx / 5xx 一律抛出 `ApiError`，从响应体 `{ "error": "..." }` 取错误码与 message；
 * 无法解析时退回 `response.statusText`。409 + body.error='task_in_progress' 时填 `currentTaskId`。
 * 网络错（fetch reject）原样向上抛 Error，调用层（useTaskPolling / useSubmitTask）会再包成 ApiError。
 */

// ============== 类型契约（与 T7 后端响应字段一一对齐） ==============

export type TaskStatus = 'pending' | 'running' | 'success' | 'failure';

/** POST /api/tasks 请求体 */
export interface SubmitTaskRequest {
  prompt: string;
  image: string | null;
}

/** POST /api/tasks 200 响应（T6 submit_task 透传 current_task_id） */
export interface SubmitTaskResponse {
  id: string;
  status: 'pending';
  current_task_id: string;
}

/** GET /api/tasks 数组项（仅 success 历史） */
export interface TaskListItem {
  id: string;
  prompt: string;
  title: string | null;
  has_image: boolean;
  /** unix 秒 */
  created_at: number;
  /** unix 秒（列表只含 success 任务，必有值） */
  finished_at: number;
}

/** GET /api/tasks/{id} 任务详情 */
export interface TaskDetail {
  id: string;
  status: TaskStatus;
  prompt: string;
  has_image: boolean;
  title: string | null;
  /** unix 秒 */
  created_at: number;
  /** unix 秒；非终态时为 null */
  finished_at: number | null;
  error_message: string | null;
}

/** GET /api/tasks/{id}/play_url 响应 */
export interface PlayUrlResponse {
  url: string;
  expires_in: number;
}

/** PATCH /api/tasks/{id} 请求体 */
export interface UpdateTitleRequest {
  title: string;
}

/** PATCH /api/tasks/{id} 响应 */
export interface UpdateTitleResponse {
  id: string;
  title: string;
}

// ============== ApiError ==============

/**
 * 客户端统一错误类。
 * - `code`：来自后端 `{ "error": "..." }` 的 error 字段；解析不出来时退回 statusText 或 'http_error'。
 * - `status`：HTTP 状态码（网络/解析错为 0）。
 * - `currentTaskId`：仅在 409 + code='task_in_progress' 时有值，来自 body.current_task_id。
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly currentTaskId?: string;

  constructor(
    message: string,
    opts: { code: string; status: number; currentTaskId?: string },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.status = opts.status;
    if (opts.currentTaskId !== undefined) {
      this.currentTaskId = opts.currentTaskId;
    }
  }
}

// ============== 内部：fetch 包装 ==============

const API_BASE = '/api';

interface BackendErrorBody {
  error?: unknown;
  current_task_id?: unknown;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);

  if (!res.ok) {
    let body: BackendErrorBody | null = null;
    try {
      body = (await res.json()) as BackendErrorBody;
    } catch {
      body = null;
    }

    const errorField =
      body && typeof body.error === 'string' ? body.error : null;
    const code = errorField ?? (res.statusText || 'http_error');
    const message = errorField ?? (res.statusText || `HTTP ${res.status}`);

    const currentTaskId =
      res.status === 409 &&
      errorField === 'task_in_progress' &&
      body &&
      typeof body.current_task_id === 'string'
        ? body.current_task_id
        : undefined;

    throw new ApiError(message, { code, status: res.status, currentTaskId });
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ============== 6 个端点的客户端函数 ==============

/**
 * 提交一个生成任务。`image` 传 raw base64（无 `data:` 前缀），文生时传 null。
 * 后端 in-flight 锁占用时会以 409 + code='task_in_progress' 抛出 ApiError，附 currentTaskId。
 */
export function submitTask(
  prompt: string,
  image: string | null,
): Promise<SubmitTaskResponse> {
  const body: SubmitTaskRequest = { prompt, image };
  return request<SubmitTaskResponse>('/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 拉取历史列表，只含 success 任务，按 finished_at 倒序（顺序由后端保证）。 */
export function listTasks(): Promise<TaskListItem[]> {
  return request<TaskListItem[]>('/tasks');
}

/** 查询单个任务的状态详情；不存在抛 ApiError(status=404)。 */
export function getTask(id: string): Promise<TaskDetail> {
  return request<TaskDetail>(`/tasks/${encodeURIComponent(id)}`);
}

/** 仅对 status=success 的任务返回播放/下载 URL（短有效期）；其它情况后端返回 404。 */
export function getPlayUrl(id: string): Promise<PlayUrlResponse> {
  return request<PlayUrlResponse>(
    `/tasks/${encodeURIComponent(id)}/play_url`,
  );
}

/** 重命名任务标题。 */
export function updateTaskTitle(
  id: string,
  title: string,
): Promise<UpdateTitleResponse> {
  const body: UpdateTitleRequest = { title };
  return request<UpdateTitleResponse>(
    `/tasks/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/** 删除任务。后端会同步清理 UFile 对象。返回 204 → void。 */
export function deleteTask(id: string): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
