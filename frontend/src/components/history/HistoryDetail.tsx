import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  deleteTask,
  getPlayUrl,
  updateTaskTitle,
} from '../../api/client';
import {
  get as getHistoryItem,
  remove as removeHistoryItem,
  updateTitle as updateHistoryTitle,
  type HistoryItem,
} from '../../storage/historyDb';
import styles from './HistoryDetail.module.css';

/**
 * 历史详情视图（大播放器 + prompt / 元数据 / 下载 / 重命名 / 删除）。
 *
 * 在本 cycle 改造为独立组件，由 `HistoryDetailPage` 在 `/history/:id` 路由命中时
 * mount，URL 切走时 unmount（取代上一 cycle 由 App.tsx 用 `key={selectedId}` 管理 remount）。
 *
 * 自身只负责：
 * - 从 IndexedDB 读这条 HistoryItem（含 prompt / hasImage / imageBase64 / imageMimeType / title）
 * - 拉一次 play_url，喂给 <video controls>
 * - 渲染首帧图（hasImage=true 且 imageBase64 在场时）
 * - 提供「下载 / 重命名 / 删除」三个操作
 *
 * 与父级的协作：
 * - 删除成功 → `onDeleted(id)` 通知父级（HistoryDetailPage 据此 navigate 回 `/history`）
 * - 重命名成功 → `onRenamed(id, newTitle)` 通知父级；HistoryPage 列表通过 IDB 5 秒轮询自然刷新
 *
 * 错误处理：
 * - 详情读取 / play_url 拉取失败 → 顶部红条；不阻塞用户尝试其他操作
 * - 重命名 / 删除失败 → 弹错条；不静默吞错
 */

export type HistoryDetailProps = {
  /** 当前要展示的历史 task id。 */
  itemId: string;
  /** 删除完成后通知父级（id 用于父级日志/分析；当前父级仅用作 trigger）。 */
  onDeleted: (id: string) => void;
  /** 重命名成功后通知父级（让左侧抽屉重新 merge 后端列表）。 */
  onRenamed: (id: string, newTitle: string) => void;
};

export function HistoryDetail({
  itemId,
  onDeleted,
  onRenamed,
}: HistoryDetailProps) {
  const [item, setItem] = useState<HistoryItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playUrlError, setPlayUrlError] = useState<string | null>(null);

  // 重命名行内编辑状态
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameInFlight, setRenameInFlight] = useState(false);

  // 删除态
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);

  // 下载态（每次点击都拉新 url，避免旧 url 过期）
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadInFlight, setDownloadInFlight] = useState(false);

  // 1) 读 IndexedDB 拿这条详情
  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setLoadError(null);
    setPlayUrl(null);
    setPlayUrlError(null);
    setIsRenaming(false);
    setRenameError(null);
    setDeleteError(null);
    setDownloadError(null);
    void (async () => {
      try {
        const found = await getHistoryItem(itemId);
        if (cancelled) return;
        if (found === undefined) {
          setLoadError('该历史记录在本地不存在；可能已被删除或缓存被清。');
        } else {
          setItem(found);
        }
      } catch (e) {
        if (cancelled) return;
        setLoadError(
          `读取本地历史失败：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // 2) 拉一次 play_url（仅本条 id 变化或首次加载）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { url } = await getPlayUrl(itemId);
        if (!cancelled) setPlayUrl(url);
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e);
        setPlayUrlError(`拉取播放链接失败：${msg}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // 3) 下载：每次点击都重拉 play_url（旧 url 可能过期）→ 临时 <a> click → remove
  const handleDownload = useCallback(async () => {
    if (item === null) return;
    setDownloadError(null);
    setDownloadInFlight(true);
    try {
      const { url } = await getPlayUrl(item.id);
      const a = document.createElement('a');
      a.href = url;
      // 文件名优先用 title，回退到 prompt 截断；再加 .mp4 后缀
      const baseName =
        (item.title !== undefined && item.title.trim().length > 0
          ? item.title
          : item.prompt
        ).slice(0, 40) || 'video';
      a.download = `${baseName}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      setDownloadError(`下载失败：${msg}`);
    } finally {
      setDownloadInFlight(false);
    }
  }, [item]);

  // 4) 重命名
  const startRename = () => {
    if (item === null) return;
    setDraftTitle(item.title ?? '');
    setRenameError(null);
    setIsRenaming(true);
  };
  const cancelRename = () => {
    setIsRenaming(false);
    setRenameError(null);
  };
  const submitRename = async () => {
    if (item === null) return;
    const next = draftTitle.trim();
    if (next.length === 0) {
      setRenameError('标题不能为空');
      return;
    }
    setRenameError(null);
    setRenameInFlight(true);
    try {
      await updateTaskTitle(item.id, next);
      await updateHistoryTitle(item.id, next);
      setItem({ ...item, title: next });
      setIsRenaming(false);
      onRenamed(item.id, next);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      setRenameError(`重命名失败：${msg}`);
    } finally {
      setRenameInFlight(false);
    }
  };

  // 5) 删除
  const handleDelete = async () => {
    if (item === null) return;
    const confirmed = window.confirm(
      `确认删除这条历史吗？此操作不可恢复。\n\n标题：${item.title ?? item.prompt.slice(0, 40)}`,
    );
    if (!confirmed) return;
    setDeleteError(null);
    setDeleteInFlight(true);
    try {
      await deleteTask(item.id);
      await removeHistoryItem(item.id);
      onDeleted(item.id);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      setDeleteError(`删除失败：${msg}`);
      setDeleteInFlight(false);
    }
    // 成功路径不重置 deleteInFlight：组件即将卸载
  };

  if (loadError !== null) {
    return (
      <div className={styles.wrap}>
        <div className={styles.errorBanner} role="alert">
          {loadError}
        </div>
      </div>
    );
  }
  if (item === null) {
    return (
      <div className={styles.wrap}>
        <div className={styles.loading}>加载中…</div>
      </div>
    );
  }

  const titleText =
    item.title !== undefined && item.title.length > 0
      ? item.title
      : item.prompt.slice(0, 40);
  const showImage =
    item.hasImage === true &&
    item.imageBase64 !== undefined &&
    item.imageBase64.length > 0;

  const actionsDisabled = renameInFlight || deleteInFlight;

  return (
    <div className={styles.wrap}>
      {/* 标题区 + 操作栏 */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>历史详情</span>
          {isRenaming ? (
            <div className={styles.renameRow}>
              <input
                className={styles.renameInput}
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="输入新标题"
                maxLength={120}
                autoFocus
                disabled={renameInFlight}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
              />
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => void submitRename()}
                disabled={renameInFlight}
              >
                {renameInFlight ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={cancelRename}
                disabled={renameInFlight}
              >
                取消
              </button>
            </div>
          ) : (
            <h2 className={styles.title}>{titleText}</h2>
          )}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => void handleDownload()}
            disabled={actionsDisabled || downloadInFlight}
          >
            {downloadInFlight ? '准备中…' : '下载'}
          </button>
          {!isRenaming && (
            <button
              type="button"
              className={styles.btnGhost}
              onClick={startRename}
              disabled={actionsDisabled}
            >
              重命名
            </button>
          )}
          <button
            type="button"
            className={styles.btnDanger}
            onClick={() => void handleDelete()}
            disabled={actionsDisabled}
          >
            {deleteInFlight ? '删除中…' : '删除'}
          </button>
        </div>
      </div>

      {renameError !== null && (
        <div className={styles.errorBanner} role="alert">
          {renameError}
        </div>
      )}
      {downloadError !== null && (
        <div className={styles.errorBanner} role="alert">
          {downloadError}
        </div>
      )}
      {deleteError !== null && (
        <div className={styles.errorBanner} role="alert">
          {deleteError}
        </div>
      )}

      {/* 视频 */}
      {playUrl !== null ? (
        <video className={styles.video} src={playUrl} controls />
      ) : (
        <div className={styles.fallback}>
          {playUrlError ?? '正在拉取播放链接…'}
        </div>
      )}

      {/* prompt 全文 */}
      <div className={styles.metaCard}>
        <span className={styles.metaLabel}>prompt 全文</span>
        <p className={styles.metaPrompt}>{item.prompt}</p>
      </div>

      {/* 首帧图（仅 hasImage=true 且本地存了 base64） */}
      {showImage && (
        <div className={styles.metaCard}>
          <span className={styles.metaLabel}>首帧参考图</span>
          <img
            className={styles.firstFrameImg}
            src={`data:${item.imageMimeType ?? 'image/png'};base64,${item.imageBase64}`}
            alt="首帧参考图"
          />
        </div>
      )}
      {item.hasImage === true && !showImage && (
        <div className={styles.metaCard}>
          <span className={styles.metaLabel}>首帧参考图</span>
          <p className={styles.metaSubtle}>
            本条历史标记了使用首帧图，但本地缓存中未保留图片字节（可能由其他设备或清缓存后再同步而来）。
          </p>
        </div>
      )}
    </div>
  );
}
