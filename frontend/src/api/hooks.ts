import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getTask,
  submitTask,
  type TaskDetail,
  type TaskStatus,
} from './client';

/**
 * 单任务状态轮询 hook。
 *
 * 行为：
 * - `enabled` 为真且 `taskId` 非空时，立即拉取一次，然后每 5 秒拉一次（setInterval）。
 * - 命中终态（success / failure）后停止定时器；后续即使 enabled 仍为真也不再拉。
 * - 卸载或 enabled 变 false 或 taskId 变化时，清掉定时器，避免泄漏。
 *
 * 返回：
 * - `task`：最近一次成功响应的详情；从未拉到时为 null。
 * - `error`：最近一次拉取的错误（一般是 ApiError）；下次成功时会清回 null。
 * - `isLoading`：是否有一次未完成的 fetch 在飞。
 */
export function useTaskPolling(
  taskId: string | null,
  enabled: boolean,
): { task: TaskDetail | null; error: ApiError | null; isLoading: boolean } {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 用 ref 持有最新 task，给定时器回调判断是否已到终态用——避免 effect 因依赖 task 频繁重启
  const latestStatusRef = useRef<TaskStatus | null>(null);
  latestStatusRef.current = task?.status ?? null;

  useEffect(() => {
    if (!enabled || !taskId) {
      return;
    }
    // 切到新的 taskId 时把旧详情清掉，避免短暂展示错配
    setTask(null);
    setError(null);
    latestStatusRef.current = null;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      // 已到终态则不再拉
      const s = latestStatusRef.current;
      if (s === 'success' || s === 'failure') {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        return;
      }
      setIsLoading(true);
      try {
        const detail = await getTask(taskId);
        if (cancelled) return;
        setTask(detail);
        setError(null);
        latestStatusRef.current = detail.status;
        if (
          (detail.status === 'success' || detail.status === 'failure') &&
          intervalId !== null
        ) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof ApiError
            ? e
            : new ApiError(e instanceof Error ? e.message : String(e), {
                code: 'network_error',
                status: 0,
              }),
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    // 立即触发一次，再每 5 秒一次
    void tick();
    intervalId = setInterval(() => {
      void tick();
    }, 5000);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
  }, [taskId, enabled]);

  return { task, error, isLoading };
}

// ===================== useSubmitTask =====================

export type SubmitState =
  | 'idle'
  | 'submitting'
  | 'running'
  | 'success'
  | 'failure';

/**
 * 提交任务的状态机 hook。
 *
 * 状态流转：
 * - 初始 `idle`。
 * - 调 `submit(prompt, imageBase64?)` 进入 `submitting`，POST 后端。
 *   - POST 200 → 进入 `running`，开启 useTaskPolling 拉详情。
 *   - POST 抛 ApiError（含 409）→ 进入 `failure`，error 字段带 ApiError；taskId 仍为 null。
 * - polling 命中 `success` / `failure` → 状态机切到对应终态；并把详情中的 error_message 暴露在 error 上。
 *
 * 暴露：
 * - `status`：当前状态机阶段。
 * - `taskId`：已成功提交后的后端 task id（POST 200 后才有）。
 * - `task`：最近一次轮询拿到的详情（含 status/error_message 等）。
 * - `error`：ApiError；POST 阶段失败放 ApiError；轮询期 success/failure 终态不视为错；任务终态 failure 时把 error_message 包成 ApiError(code='task_failed') 放进来便于上层渲染。
 * - `submit(prompt, imageBase64?)`：触发提交。前端**不传 title**——title 通过 PATCH 单独设置（updateTaskTitle）。
 *   连续调用是安全的：submit 内部会先把状态切回 submitting 并清掉旧 error / taskId。
 */
export function useSubmitTask(): {
  status: SubmitState;
  taskId: string | null;
  task: TaskDetail | null;
  error: ApiError | null;
  submit: (prompt: string, imageBase64?: string) => Promise<void>;
} {
  const [status, setStatus] = useState<SubmitState>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  // 仅在 status === 'running' 时启动轮询
  const polling = useTaskPolling(taskId, status === 'running');

  // 当 polling 命中终态，把状态机推到 success/failure
  useEffect(() => {
    if (status !== 'running') return;
    const t = polling.task;
    if (!t) return;
    if (t.status === 'success') {
      setStatus('success');
      setError(null);
    } else if (t.status === 'failure') {
      setStatus('failure');
      setError(
        new ApiError(t.error_message ?? '任务失败', {
          code: 'task_failed',
          status: 0,
        }),
      );
    }
  }, [polling.task, status]);

  const submit = async (prompt: string, imageBase64?: string) => {
    setStatus('submitting');
    setError(null);
    setTaskId(null);
    try {
      const res = await submitTask(prompt, imageBase64 ?? null);
      setTaskId(res.id);
      setStatus('running');
    } catch (e) {
      const err =
        e instanceof ApiError
          ? e
          : new ApiError(e instanceof Error ? e.message : String(e), {
              code: 'network_error',
              status: 0,
            });
      setError(err);
      setStatus('failure');
    }
  };

  return {
    status,
    taskId,
    task: polling.task,
    error,
    submit,
  };
}
