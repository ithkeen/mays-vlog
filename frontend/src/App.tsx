import { useState } from 'react';
import { HistoryDetail } from './components/HistoryDetail';
import { HistoryDrawer } from './components/HistoryDrawer';
import { SubmissionWorkspace } from './components/SubmissionWorkspace';
import styles from './App.module.css';

/**
 * 应用根组件——双栏布局 + 主工作区两态切换。
 *
 * 左栏：HistoryDrawer（T12），消费 selectedId / onSelect / refreshTick
 * 右栏（两态二选一）：
 *   - 未选中历史 → SubmissionWorkspace（T11 主输入页 / 提交流），可通过 resetKey remount 回 idle
 *   - 已选中历史 → HistoryDetail（T12 历史详情），用 itemId 作为 key 强制重挂
 *
 * 三个父级 state：
 *   selectedId：null = 主输入页；string = 当前历史详情 id
 *   resetKey：自增以重置 SubmissionWorkspace
 *   refreshTick：自增以让 HistoryDrawer 再做一次「listTasks → mergeFromBackend → getAll」
 */
function App() {
  const [resetKey, setResetKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const bumpRefresh = () => setRefreshTick((n) => n + 1);

  const handleSelectHistory = (id: string) => {
    setSelectedId(id);
  };

  const handleHistoryDeleted = () => {
    // 删除后回到主输入页，并触发抽屉再 merge
    setSelectedId(null);
    bumpRefresh();
  };

  const handleHistoryRenamed = () => {
    // 重命名只让左侧抽屉重新对齐后端
    bumpRefresh();
  };

  return (
    <div className={styles.app}>
      <HistoryDrawer
        selectedId={selectedId}
        onSelect={handleSelectHistory}
        refreshTick={refreshTick}
      />
      <main className={styles.main}>
        <header className={styles.mainHeader}>
          <h1 className={styles.mainTitle}>视频生成台</h1>
          <span className={styles.mainHint}>
            {selectedId === null ? 'READY' : 'HISTORY'}
          </span>
        </header>
        <section className={styles.mainBody}>
          {selectedId === null ? (
            <SubmissionWorkspace
              key={resetKey}
              onResetRequested={() => {
                setResetKey((n) => n + 1);
                bumpRefresh();
              }}
            />
          ) : (
            <HistoryDetail
              key={selectedId}
              itemId={selectedId}
              onDeleted={handleHistoryDeleted}
              onRenamed={handleHistoryRenamed}
            />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
