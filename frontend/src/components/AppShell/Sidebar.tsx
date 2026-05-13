import { NavLink } from 'react-router-dom';
import { Sparkles, Clock, Users, type LucideIcon } from 'lucide-react';
import styles from './Sidebar.module.css';

/**
 * Sidebar——常驻窄态主导航。
 *
 * - 宽度 72px（在 AppShell grid 中固定，介于 64–80px 区间）
 * - 顶部小 logo + 应用名；底部留空
 * - 三个一级入口：Generate / History / Characters，icon + label 竖堆
 * - 选中态：图标 / 文字加深 + 左侧 2px 冷蓝（accent）竖线
 * - NavLink 自动补 aria-current="page"
 */
type NavEntry = { to: string; label: string; icon: LucideIcon };

const NAV_ITEMS: NavEntry[] = [
  { to: '/generate', label: 'Generate', icon: Sparkles },
  { to: '/history', label: 'History', icon: Clock },
  { to: '/characters', label: 'Characters', icon: Users },
];

export function Sidebar() {
  return (
    <aside className={styles.sidebar} aria-label="主导航">
      <div className={styles.brand}>
        <div className={styles.logo} aria-hidden="true">M</div>
        <div className={styles.brandName}>Mays</div>
      </div>
      <nav className={styles.nav}>
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              isActive ? `${styles.item} ${styles.itemActive}` : styles.item
            }
          >
            <Icon className={styles.icon} size={20} strokeWidth={1.75} aria-hidden="true" />
            <span className={styles.label}>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
