import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { GeneratePage } from '../../pages/GeneratePage';
import { HistoryPage } from '../../pages/HistoryPage';
import { HistoryDetailPage } from '../../pages/HistoryDetailPage';
import { CharactersPage } from '../../pages/CharactersPage';
import styles from './AppShell.module.css';

/**
 * AppShell——两列 grid 外壳（sidebar + 主区 outlet）。
 *
 * keep-mounted 约定：
 * - Generate / History 列表 / Characters 列表三个一级页面常驻渲染，
 *   用 display: block/none 切换可见性以保活内部状态（如 Generate 的轮询 hook）。
 * - HistoryDetailPage（/history/:id）是普通 route 组件，随 URL 切换 mount/unmount。
 * - 非活动 wrapper 同时加 aria-hidden="true" + tabIndex=-1 + pointer-events:none，
 *   防止 Tab 意外落到隐藏子树。
 *
 * 路由兜底：
 * - `/` → 重定向到 `/generate`
 * - 未命中任何已知 path → 重定向到 `/generate`
 * 已知 path 在 Routes 里显式列出并给 element={null}，避免被 `*` 吞掉。
 */
export function AppShell() {
  const location = useLocation();
  const first = '/' + (location.pathname.split('/')[1] ?? '');
  const isHistoryDetail = /^\/history\/[^/]+\/?$/.test(location.pathname);

  const generateActive = first === '/generate';
  const historyActive = first === '/history' && !isHistoryDetail;
  const charactersActive = first === '/characters';

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <PageWrapper active={generateActive}>
          <GeneratePage />
        </PageWrapper>
        <PageWrapper active={historyActive}>
          <HistoryPage />
        </PageWrapper>
        <PageWrapper active={charactersActive}>
          <CharactersPage />
        </PageWrapper>
        <Routes>
          <Route path="/" element={<Navigate to="/generate" replace />} />
          <Route path="/generate" element={null} />
          <Route path="/history" element={null} />
          <Route path="/history/:id" element={<HistoryDetailPage />} />
          <Route path="/characters" element={null} />
          <Route path="/characters/new" element={null} />
          <Route path="*" element={<Navigate to="/generate" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function PageWrapper({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={styles.pageWrapper}
      style={{ display: active ? 'block' : 'none' }}
      aria-hidden={!active}
      tabIndex={active ? undefined : -1}
    >
      {children}
    </div>
  );
}
