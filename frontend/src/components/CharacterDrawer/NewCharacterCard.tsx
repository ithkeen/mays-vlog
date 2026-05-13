import styles from './NewCharacterCard.module.css'

/**
 * 网格首格的「新建角色」占位卡。
 *
 * - 视觉上与普通角色卡尺寸 / 比例一致，但用虚线边框 + 居中 `+` 与提示文案
 *   表达「这是入口而非内容」。
 * - 点击调用 `onClick`；本组件不负责切抽屉态，由 `CharacterDrawer` 父级处理。
 * - 渲染为 `<button>` 而非 `<div onClick>`，天然带键盘可达与 focus 态（焦点
 *   态走 `:root` 定义的全局 `:focus-visible`）。
 */
export type NewCharacterCardProps = {
  onClick: () => void
}

export function NewCharacterCard({ onClick }: NewCharacterCardProps) {
  return (
    <button
      type="button"
      className={styles.card}
      onClick={onClick}
      aria-label="新建角色"
    >
      <span className={styles.plus} aria-hidden="true">
        +
      </span>
      <span className={styles.label}>新建角色</span>
    </button>
  )
}
