import { PageHeader } from '../components/AppShell/PageHeader';

/**
 * HistoryDetailPage 骨架——T1 仅渲染 PageHeader 占位。
 * 非 keep-mounted：由 /history/:id route 正常 mount/unmount。
 * 详情视图集成留给后续 task。
 */
export function HistoryDetailPage() {
  return (
    <>
      <PageHeader title="History" />
    </>
  );
}
