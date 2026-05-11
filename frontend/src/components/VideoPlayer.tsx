import styles from './VideoPlayer.module.css';

export type VideoPlayerProps = {
  /** 来自 GET /api/tasks/:id/play_url 的签名 URL；获取失败时为 null。 */
  url: string | null;
  /** 用户点「再生成一个」时切回输入态。 */
  onNewSubmission: () => void;
  /** url 为 null 时展示的回退文案。 */
  fallbackMessage?: string;
};

/**
 * 单视频播放面板。
 * - url 就绪：渲染 <video controls>（acceptance 要求的 success 终态主区域 UI）
 * - url 为 null：展示 fallback 文案，仍提供「再生成一个」入口
 */
export function VideoPlayer({
  url,
  onNewSubmission,
  fallbackMessage,
}: VideoPlayerProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.statusBadge}>已生成</span>
        <button
          type="button"
          className={styles.againBtn}
          onClick={onNewSubmission}
        >
          再生成一个
        </button>
      </div>
      {url !== null ? (
        <video className={styles.video} src={url} controls />
      ) : (
        <div className={styles.fallback}>
          {fallbackMessage ?? '无法加载视频，请稍后从历史菜单重试'}
        </div>
      )}
    </div>
  );
}
