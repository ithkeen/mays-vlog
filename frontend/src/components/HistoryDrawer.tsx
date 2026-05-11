import styles from './HistoryDrawer.module.css';

/**
 * 历史抽屉占位组件。
 *
 * T11 仅留占位文案，T12 会用真实历史菜单（列表 / 播放 / 下载 / 重命名 / 删除）替换本文件。
 * 抽出独立组件是为了让 T12 接管时不必触碰 App.tsx 的整体结构。
 */
export function HistoryDrawer() {
  return (
    <aside className={styles.drawer} aria-label="历史">
      <div className={styles.header}>
        <span className={styles.title}>历史</span>
        <span className={styles.badge}>EMPTY</span>
      </div>
      <div className={styles.body}>历史列表将在 T12 接入</div>
    </aside>
  );
}
