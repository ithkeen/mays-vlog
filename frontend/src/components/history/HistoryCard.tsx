import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayUrlPool } from '../../hooks/usePlayUrlPool';
import type { HistoryItem } from '../../storage/historyDb';
import styles from './HistoryCard.module.css';

/**
 * HistoryCard——History 列表的 grid 卡。
 *
 * 行为契约（DESIGN.md「关键流程 3」/「错误处理」/ REQUIREMENT.md「History 页」）：
 * - 通过 `usePlayUrlPool` 拿 `play_url`（最多 6 并发，1h 缓存）
 * - 拿到 URL 后挂 `<video preload="metadata" muted playsInline>`，`onLoadedMetadata`
 *   时把 `currentTime = 0.1` 取首帧
 * - play_url 获取失败 / video metadata 加载失败 → 背景退化为浅冷灰纯色占位；
 *   标题和时间仍展示；卡仍可点击进入详情
 * - 点击卡片 → `navigate('/history/{id}')`
 */
export type HistoryCardProps = { item: HistoryItem };

const relativeFmt = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

function formatRelative(nowMs: number, finishedAtMs: number): string {
  const deltaSec = Math.round((finishedAtMs - nowMs) / 1000);
  const absSec = Math.abs(deltaSec);
  if (absSec < 60) return relativeFmt.format(deltaSec, 'second');
  if (absSec < 3600) return relativeFmt.format(Math.round(deltaSec / 60), 'minute');
  if (absSec < 86_400) return relativeFmt.format(Math.round(deltaSec / 3600), 'hour');
  if (absSec < 86_400 * 30)
    return relativeFmt.format(Math.round(deltaSec / 86_400), 'day');
  if (absSec < 86_400 * 365)
    return relativeFmt.format(Math.round(deltaSec / (86_400 * 30)), 'month');
  return relativeFmt.format(Math.round(deltaSec / (86_400 * 365)), 'year');
}

const RELATIVE_TIME_TICK_MS = 60_000;

export function HistoryCard({ item }: HistoryCardProps) {
  const navigate = useNavigate();
  const ids = useMemo(() => [item.id], [item.id]);
  const pool = usePlayUrlPool(ids);
  const entry = pool.get(item.id);
  const url = entry?.url;
  const poolErrored = entry?.status === 'error';

  const [videoErrored, setVideoErrored] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), RELATIVE_TIME_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // url 变化时重置 video 错误态（例如缓存过期重取后）
  useEffect(() => {
    setVideoErrored(false);
  }, [url]);

  const failed = poolErrored || videoErrored;
  const titleText =
    item.title !== undefined && item.title.length > 0
      ? item.title
      : item.prompt;

  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => navigate(`/history/${item.id}`)}
      aria-label={titleText}
    >
      <div className={styles.media}>
        {!failed && url !== undefined && (
          <video
            ref={videoRef}
            className={styles.video}
            src={url}
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (v !== null) {
                try {
                  v.currentTime = 0.1;
                } catch {
                  // 极少数浏览器在 metadata 阶段拒绝设置 currentTime；忽略，让用户看到黑底
                }
              }
            }}
            onError={() => setVideoErrored(true)}
          />
        )}
        {failed && <div className={styles.fallback} aria-hidden="true" />}
        <div className={styles.overlay} aria-hidden="true" />
        <div className={styles.text}>
          <span className={styles.title}>{titleText}</span>
          <span className={styles.time}>{formatRelative(now, item.finishedAt)}</span>
        </div>
      </div>
    </button>
  );
}
