import { useCallback, useEffect, useState } from 'react';
import { listTasks } from '../api/client';
import {
  getAll,
  mergeFromBackend,
  type HistoryItem,
} from '../storage/historyDb';
import styles from './HistoryDrawer.module.css';

/**
 * 左侧历史列表抽屉。
 *
 * 数据源：
 * - 应用启动 / 父级 `refreshTick` 变化（rename / delete 联动）→ `listTasks` + `mergeFromBackend`
 *   → `getAll`，以后端为权威。
 * - 5 秒一次轻量 `getAll`：捕获 `SubmissionWorkspace` 成功后直接写入 IndexedDB 的新条目
 *   （它不走父级回调，所以这里用本地轮询补齐——单用户单浏览器 MVP 下成本可忽略）。
 *
 * 排序：依赖 `historyDb.getAll()` 已按 `finishedAt DESC` 返回。
 * 标题展示：`item.title || item.prompt`，再截到 `MAX_TITLE_CHARS` 字。
 * 相对时间：基于 `Intl.RelativeTimeFormat('zh-CN', {numeric:'auto'})`，每分钟刷新一次。
 */

export type HistoryDrawerProps = {
  /** 当前选中的历史 id；null 表示未选中（右侧渲染主输入页）。 */
  selectedId: string | null;
  /** 用户点击某条历史项时触发。 */
  onSelect: (id: string) => void;
  /**
   * 父级递增本字段以强制再做一次后端 merge。
   * - 历史详情 rename / delete 成功后增。
   * - 也可用于其他需要"以后端为权威"重新对齐的场景。
   */
  refreshTick: number;
  /**
   * 用户在抽屉头部点关闭按钮（T6 引入）。父级把抽屉单值状态切到 'none'，
   * 配合 App 层的 grid 列宽塌缩实现「关闭」语义。
   */
  onClose: () => void;
};

const MAX_TITLE_CHARS = 40;
const LOCAL_POLL_MS = 5000;
const RELATIVE_TIME_TICK_MS = 60_000;

const relativeFmt = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

function displayTitle(item: HistoryItem): string {
  const raw =
    item.title !== undefined && item.title.length > 0 ? item.title : item.prompt;
  const trimmed = raw.trim();
  if (trimmed.length <= MAX_TITLE_CHARS) return trimmed;
  return trimmed.slice(0, MAX_TITLE_CHARS) + '…';
}

/** 把 unix ms 转成「X 秒前 / X 分钟前 / 昨天 / X 天前 / X 个月前 / X 年前」之类中文。 */
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

export function HistoryDrawer({
  selectedId,
  onSelect,
  refreshTick,
  onClose,
}: HistoryDrawerProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const refreshLocal = useCallback(async (): Promise<void> => {
    const list = await getAll();
    setItems(list);
  }, []);

  // mergeFromBackend 主同步：mount + refreshTick 变化时
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const backendList = await listTasks();
        if (cancelled) return;
        await mergeFromBackend(backendList);
        if (cancelled) return;
        await refreshLocal();
        if (!cancelled) setSyncError(null);
      } catch (e) {
        // 后端不可达时降级：仍展示本地缓存
        if (cancelled) return;
        try {
          await refreshLocal();
        } catch {
          // 本地读取也失败时下面的 setSyncError 仍会展示
        }
        if (!cancelled) {
          setSyncError(
            `从后端同步失败：${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, refreshLocal]);

  // 5 秒轻量本地刷新：覆盖 SubmissionWorkspace 写入 IDB 的新条目
  useEffect(() => {
    const intervalId = setInterval(() => {
      void refreshLocal().catch(() => {
        // 静默：与主同步路径错误展示分离，避免轮询失败刷屏
      });
    }, LOCAL_POLL_MS);
    return () => clearInterval(intervalId);
  }, [refreshLocal]);

  // 每分钟重算一次相对时间
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), RELATIVE_TIME_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className={styles.drawer} aria-label="历史">
      <div className={styles.header}>
        <span className={styles.title}>历史</span>
        <div className={styles.headerRight}>
          <span className={styles.badge}>
            {items.length === 0 ? 'EMPTY' : String(items.length)}
          </span>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭历史抽屉"
          >
            ×
          </button>
        </div>
      </div>

      {syncError !== null && (
        <div className={styles.errorBanner} role="alert">
          {syncError}
        </div>
      )}

      {items.length === 0 ? (
        <div className={styles.emptyBody}>
          还没有生成过视频；先去右边写一段 prompt 试试。
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => {
            const isSelected = item.id === selectedId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={
                    isSelected
                      ? `${styles.item} ${styles.itemSelected}`
                      : styles.item
                  }
                  onClick={() => onSelect(item.id)}
                  aria-current={isSelected ? 'true' : undefined}
                >
                  <span className={styles.itemTitle}>{displayTitle(item)}</span>
                  <span className={styles.itemMeta}>
                    {item.hasImage && (
                      <span className={styles.imgBadge}>IMG</span>
                    )}
                    <span className={styles.itemTime}>
                      {formatRelative(now, item.finishedAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
