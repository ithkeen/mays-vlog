import { useState } from 'react';
import { CharacterDrawer } from './components/CharacterDrawer/CharacterDrawer';
import { HistoryDetail } from './components/HistoryDetail';
import { HistoryDrawer } from './components/HistoryDrawer';
import { SubmissionWorkspace } from './components/SubmissionWorkspace';
import styles from './App.module.css';

/**
 * 应用根组件——双栏布局 + 主工作区两态切换 + 顶部抽屉互斥入口。
 *
 * 抽屉互斥模型（T6）：
 *   openDrawer: 'none' | 'history' | 'characters'
 *   - 'history'：左侧 HistoryDrawer 占位列展开（沿用既有 sidebar 宽度）；CharacterDrawer 退出
 *   - 'characters'：CharacterDrawer 浮入；HistoryDrawer 占位列同帧塌成 0 宽并 aria-hidden
 *   - 'none'：两者都关；主内容区铺满
 *   切到任意一态都同帧关闭另一态，确保同一时刻只有一个抽屉可见。
 *   默认 'history'：与本 cycle 之前 HistoryDrawer 常驻显示的口径一致，不让老用户感知到回归。
 *
 * 其他职责（沿用旧实现）：
 * 左栏：HistoryDrawer，消费 selectedId / onSelect / refreshTick；新增 onClose 把状态切回 'none'
 * 右栏（两态二选一）：
 *   - 未选中历史 → SubmissionWorkspace（T11 主输入页 / 提交流），可通过 resetKey remount 回 idle
 *   - 已选中历史 → HistoryDetail（T12 历史详情），用 itemId 作为 key 强制重挂
 *
 * 三个父级 state：
 *   selectedId：null = 主输入页；string = 当前历史详情 id
 *   resetKey：自增以重置 SubmissionWorkspace
 *   refreshTick：自增以让 HistoryDrawer 再做一次「listTasks → mergeFromBackend → getAll」
 */

type OpenDrawer = 'none' | 'history' | 'characters';

function App() {
  const [resetKey, setResetKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>('history');

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

  // 互斥开关：点同名按钮时关闭自己；点对方按钮时切到对方（自然把自己关掉）
  const handleToggleHistory = () => {
    setOpenDrawer((cur) => (cur === 'history' ? 'none' : 'history'));
  };
  const handleToggleCharacters = () => {
    setOpenDrawer((cur) => (cur === 'characters' ? 'none' : 'characters'));
  };
  const handleCloseAnyDrawer = () => setOpenDrawer('none');

  const historyOpen = openDrawer === 'history';
  const charactersOpen = openDrawer === 'characters';

  const appClassName = historyOpen
    ? `${styles.app} ${styles.appHistoryOpen}`
    : styles.app;

  return (
    <div className={appClassName}>
      <div
        className={historyOpen ? styles.aside : `${styles.aside} ${styles.asideClosed}`}
        aria-hidden={!historyOpen}
      >
        <HistoryDrawer
          selectedId={selectedId}
          onSelect={handleSelectHistory}
          refreshTick={refreshTick}
          onClose={handleCloseAnyDrawer}
        />
      </div>
      <main className={styles.main}>
        <header className={styles.mainHeader}>
          <div className={styles.headerLeft}>
            <h1 className={styles.mainTitle}>视频生成台</h1>
            <span className={styles.mainHint}>
              {selectedId === null ? 'READY' : 'HISTORY'}
            </span>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={
                historyOpen
                  ? `${styles.drawerToggle} ${styles.drawerToggleActive}`
                  : styles.drawerToggle
              }
              onClick={handleToggleHistory}
              aria-pressed={historyOpen}
              aria-label={historyOpen ? '关闭历史抽屉' : '打开历史抽屉'}
            >
              <svg
                className={styles.toggleIcon}
                viewBox="0 0 16 16"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M8 3.5v4.5l3 1.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle
                  cx="8"
                  cy="8"
                  r="5.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                />
              </svg>
              <span>历史</span>
            </button>
            <button
              type="button"
              className={
                charactersOpen
                  ? `${styles.drawerToggle} ${styles.drawerToggleActive}`
                  : styles.drawerToggle
              }
              onClick={handleToggleCharacters}
              aria-pressed={charactersOpen}
              aria-label={charactersOpen ? '关闭角色库抽屉' : '打开角色库抽屉'}
            >
              <svg
                className={styles.toggleIcon}
                viewBox="0 0 16 16"
                aria-hidden="true"
                focusable="false"
              >
                <circle
                  cx="8"
                  cy="6"
                  r="2.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                />
                <path
                  d="M2.5 13.25c.85-2.4 3-3.75 5.5-3.75s4.65 1.35 5.5 3.75"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                />
              </svg>
              <span>角色库</span>
            </button>
          </div>
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
      <CharacterDrawer open={charactersOpen} onClose={handleCloseAnyDrawer} />
    </div>
  );
}

export default App;
