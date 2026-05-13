import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/AppShell/PageHeader';
import { HistoryCard } from '../components/history/HistoryCard';
import { listTasks } from '../api/client';
import {
  getAll,
  mergeFromBackend,
  type HistoryItem,
} from '../storage/historyDb';
import styles from './HistoryPage.module.css';

/**
 * HistoryPage——`/history` 路由页面。
 *
 * 数据源（与原 HistoryDrawer 同源策略，但承载在 grid 列表上）：
 * - mount 时：`listTasks()` → `mergeFromBackend()` → `getAll()`，以后端为权威
 * - 5 秒轻量本地 `getAll()`：让 SubmissionWorkspace 直接写入 IDB 的新条目自动出现
 * - 后端不可达时降级：仅展示本地缓存 + 顶部红条提示同步失败原因
 *
 * 排序：`historyDb.getAll()` 已按 `finishedAt DESC` 返回。
 *
 * 空态：列表为空时显示空态文案 + 引导跳 Generate 的按钮。
 */
const LOCAL_POLL_MS = 5000;

export function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);

  const refreshLocal = useCallback(async (): Promise<void> => {
    const list = await getAll();
    setItems(list);
  }, []);

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
        if (cancelled) return;
        try {
          await refreshLocal();
        } catch {
          // 本地读取失败时下方 syncError 仍会显示
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
  }, [refreshLocal]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      void refreshLocal().catch(() => {
        // 静默：与主同步路径错误展示分离，避免轮询失败刷屏
      });
    }, LOCAL_POLL_MS);
    return () => clearInterval(intervalId);
  }, [refreshLocal]);

  return (
    <>
      <PageHeader title="History" />
      <div className={styles.body}>
        {syncError !== null && (
          <div className={styles.errorBanner} role="alert">
            {syncError}
          </div>
        )}

        {items.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>还没有作品</p>
            <p className={styles.emptyHint}>
              去 Generate 页写一段 prompt 生成你的第一个视频吧。
            </p>
            <button
              type="button"
              className={styles.emptyCta}
              onClick={() => navigate('/generate')}
            >
              去 Generate
            </button>
          </div>
        ) : (
          <ul className={styles.grid}>
            {items.map((item) => (
              <li key={item.id} className={styles.gridItem}>
                <HistoryCard item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
