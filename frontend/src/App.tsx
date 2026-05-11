import styles from './App.module.css'

/**
 * 应用根组件——MVP 占位双栏布局。
 *
 * 左侧 sidebar 区域将由 T11（HistoryDrawer）替换为历史列表；
 * 右侧 main 区域将由 T10/T12 填充输入区、进度态、播放器。
 * 这里只占位，不预写未来组件结构。
 */
function App() {
  return (
    <div className={styles.app}>
      <aside className={styles.sidebar} aria-label="历史">
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>历史</span>
          <span className={styles.sidebarBadge}>EMPTY</span>
        </div>
        <div className={styles.sidebarBody}>
          后续 task 将在此渲染历史列表
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.mainHeader}>
          <h1 className={styles.mainTitle}>主工作区</h1>
          <span className={styles.mainHint}>READY</span>
        </header>
        <section className={styles.mainBody}>
          后续 task 将在此渲染输入区、进度态与视频播放器
        </section>
      </main>
    </div>
  )
}

export default App
