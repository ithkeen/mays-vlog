import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

/**
 * PageHeader——主区顶部 header。
 * 左侧：标题槽位（title prop）；右侧：当前无内容，留空等待后续 cycle 扩展。
 */
export function PageHeader({ title }: { title: ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.title}>{title}</h1>
      </div>
      <div className={styles.right} />
    </header>
  );
}
