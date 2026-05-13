import { useNavigate } from 'react-router-dom'
import styles from './NewCharacterCard.module.css'

/**
 * Characters grid 首位的「新建角色」占位卡。
 *
 * - 与角色卡同尺寸（方形主视觉），但用浅色面板 + 居中 `+` icon + 双行文案
 *   表达「这是入口，不是内容」。
 * - 点击直接 `navigate('/characters/new')`，URL 切到创建表单态；
 *   不再依赖原 CharacterDrawer 的 `openDrawer` 状态。
 */
export function NewCharacterCard() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => navigate('/characters/new')}
      aria-label="新建角色"
    >
      <span className={styles.plus} aria-hidden="true">
        +
      </span>
      <span className={styles.title}>New Character</span>
      <span className={styles.subtitle}>Create your own</span>
    </button>
  )
}
