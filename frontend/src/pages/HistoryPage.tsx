import { PageHeader } from '../components/AppShell/PageHeader';

/**
 * HistoryPage 骨架——T1 仅渲染 PageHeader 占位。
 * grid 列表与 HistoryCard 集成留给后续 task。
 */
export function HistoryPage() {
  return (
    <>
      <PageHeader title="History" />
    </>
  );
}
