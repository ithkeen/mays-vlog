import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../components/AppShell/PageHeader';
import { HistoryDetail } from '../components/history/HistoryDetail';
import { get as getHistoryItem } from '../storage/historyDb';
import styles from './HistoryDetailPage.module.css';

/**
 * HistoryDetailPage——`/history/:id` 路由页面。
 *
 * 非 keep-mounted：随 URL mount/unmount。
 *
 * 流程：
 * 1. 从 `useParams().id` 拿到目标 id；先去 IDB 预查存在性
 * 2. 不存在（手敲 URL / 已删除）→ 显示「未找到该作品」+ 返回列表按钮；不抛异常、不跳转
 * 3. 存在 → 渲染 `<HistoryDetail itemId={id}>`，详情内部再走自身的读 IDB / 拉 play_url
 *
 * `PageHeader` 标题处提供返回入口（左侧 `<` 图标按钮 + 面包屑 `History / 标题`），
 * 点击 → `navigate('/history')`。
 */
type Existence = 'checking' | 'present' | 'missing';

export function HistoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [existence, setExistence] = useState<Existence>('checking');
  const [titleHint, setTitleHint] = useState<string>('');

  useEffect(() => {
    if (id === undefined || id.length === 0) {
      setExistence('missing');
      return;
    }
    let cancelled = false;
    setExistence('checking');
    void (async () => {
      try {
        const found = await getHistoryItem(id);
        if (cancelled) return;
        if (found === undefined) {
          setExistence('missing');
        } else {
          setExistence('present');
          const t =
            found.title !== undefined && found.title.length > 0
              ? found.title
              : found.prompt;
          setTitleHint(t.slice(0, 40));
        }
      } catch {
        // IDB 读取失败也按 missing 处理（保守：避免把页面卡在 checking）
        if (!cancelled) setExistence('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const headerTitle = (
    <span className={styles.crumb}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => navigate('/history')}
        aria-label="返回 History 列表"
      >
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.crumbLink}
        onClick={() => navigate('/history')}
      >
        History
      </button>
      {existence === 'present' && titleHint.length > 0 && (
        <>
          <span className={styles.crumbSep} aria-hidden="true">
            /
          </span>
          <span className={styles.crumbCurrent} title={titleHint}>
            {titleHint}
          </span>
        </>
      )}
    </span>
  );

  return (
    <>
      <PageHeader title={headerTitle} />
      <div className={styles.body}>
        {existence === 'checking' && (
          <div className={styles.loading}>加载中…</div>
        )}
        {existence === 'missing' && (
          <div className={styles.notFound}>
            <p className={styles.notFoundTitle}>未找到该作品</p>
            <p className={styles.notFoundHint}>
              它可能已被删除，或者本地缓存中没有这条记录。
            </p>
            <button
              type="button"
              className={styles.backCta}
              onClick={() => navigate('/history')}
            >
              返回 History 列表
            </button>
          </div>
        )}
        {existence === 'present' && id !== undefined && (
          <HistoryDetail
            itemId={id}
            onDeleted={() => navigate('/history')}
            onRenamed={(_id, newTitle) => setTitleHint(newTitle.slice(0, 40))}
          />
        )}
      </div>
    </>
  );
}
