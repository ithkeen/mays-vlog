import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

/**
 * Sidebar——占位版。
 * 当前仅提供 3 个 NavLink 跑通路由 + 高亮态；完整视觉样式由 T2 实现。
 * NavLink 的 aria-current 由 react-router-dom 自动附加。
 */
export function Sidebar() {
  return (
    <aside className={styles.sidebar} aria-label="主导航">
      <nav className={styles.nav}>
        <NavLink
          to="/generate"
          className={({ isActive }) =>
            isActive ? `${styles.item} ${styles.itemActive}` : styles.item
          }
        >
          Generate
        </NavLink>
        <NavLink
          to="/history"
          className={({ isActive }) =>
            isActive ? `${styles.item} ${styles.itemActive}` : styles.item
          }
        >
          History
        </NavLink>
        <NavLink
          to="/characters"
          className={({ isActive }) =>
            isActive ? `${styles.item} ${styles.itemActive}` : styles.item
          }
        >
          Characters
        </NavLink>
      </nav>
    </aside>
  );
}
