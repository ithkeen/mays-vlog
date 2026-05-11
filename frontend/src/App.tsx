import { useState } from 'react';
import { HistoryDrawer } from './components/HistoryDrawer';
import { SubmissionWorkspace } from './components/SubmissionWorkspace';
import styles from './App.module.css';

/**
 * 应用根组件——双栏布局。
 *
 * 左栏：HistoryDrawer 占位（T12 接管历史菜单的真实实现）
 * 右栏：SubmissionWorkspace（输入 / 提交 / 生成中 / 失败 / 成功），
 *       通过 `key={resetKey}` 实现「再生成一个」的 remount-reset 模式。
 */
function App() {
  const [resetKey, setResetKey] = useState(0);

  return (
    <div className={styles.app}>
      <HistoryDrawer />
      <main className={styles.main}>
        <header className={styles.mainHeader}>
          <h1 className={styles.mainTitle}>视频生成台</h1>
          <span className={styles.mainHint}>READY</span>
        </header>
        <section className={styles.mainBody}>
          <SubmissionWorkspace
            key={resetKey}
            onResetRequested={() => setResetKey((n) => n + 1)}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
