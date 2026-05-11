import type { ApiError } from '../api/client';
import type { SubmitState } from '../api/hooks';
import styles from './ProgressPanel.module.css';

export type ProgressPanelProps = {
  status: SubmitState;
  error: ApiError | null;
};

/**
 * 「生成中」spinner 与失败提示的非阻塞条幅。
 *
 * 渲染规则：
 * - submitting / running → spinner + 文案（不阻塞输入区）
 * - failure → 错误条；409 + code=task_in_progress 时显示当前 in-flight task id
 * - idle / success → 不渲染（success 时父级已切到视频视图，本组件不会被挂载）
 */
export function ProgressPanel({ status, error }: ProgressPanelProps) {
  if (status === 'submitting' || status === 'running') {
    return (
      <div className={styles.panel} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        <div className={styles.text}>
          <div className={styles.title}>生成中…</div>
          <div className={styles.subtitle}>
            {status === 'submitting'
              ? '正在提交任务到后端'
              : '生成视频通常需要 1～5 分钟，请保持页面打开'}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'failure' && error) {
    const isInProgress = error.code === 'task_in_progress';
    return (
      <div
        className={`${styles.panel} ${styles.panelError}`}
        role="alert"
        aria-live="assertive"
      >
        <span className={styles.errorMark} aria-hidden="true">
          !
        </span>
        <div className={styles.text}>
          <div className={styles.errorTitle}>
            {isInProgress ? '当前已有任务运行' : '生成失败'}
          </div>
          <div className={styles.errorBody}>
            {isInProgress
              ? `请等当前任务结束后再提交（id: ${error.currentTaskId ?? '未知'}）`
              : error.message}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
