import { useEffect, useState } from 'react'
import type { Character } from '../../storage/charactersDb'
import styles from './CharacterCard.module.css'

/**
 * 角色展示卡（grid 卡片样式）。
 *
 * 视觉：
 * - 默认态：方形主视觉，参考图满铺背景；底部从透明到黑的渐变叠层；左下角显示 Name。
 * - 展开态：卡自身 `grid-row: span 2`——在网格里向下纵向抽高一格，同行其它卡不动；
 *   下半格用浅色面板展示 Instructions 与删除操作。
 *
 * 行为：
 * - 点击主视觉头部 → 切换展开 / 折叠。
 * - 删除二次确认：单按钮「删除」点击后就地变态为「取消 | 确认删除」两个并排按钮。
 * - 折叠时一并把删除确认态重置。
 * - 本组件不碰 IDB，删除通过 props 上抛。
 *
 * 资源：
 * - `URL.createObjectURL(image)` 渲染参考图；image Blob 引用变化或 unmount 时 revoke。
 */

export type CharacterCardProps = {
  character: Character
  onDelete: (id: string) => void
}

export function CharacterCard({ character, onDelete }: CharacterCardProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<boolean>(false)
  const [imageUrl, setImageUrl] = useState<string>('')

  useEffect(() => {
    const url = URL.createObjectURL(character.image)
    setImageUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [character.image])

  const toggleExpand = () => {
    setIsExpanded((prev) => {
      const next = !prev
      if (!next) setIsConfirmingDelete(false)
      return next
    })
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsConfirmingDelete(true)
  }

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsConfirmingDelete(false)
  }

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(character.id)
  }

  const hasInstructions =
    character.instructions !== undefined &&
    character.instructions.trim().length > 0

  return (
    <article
      className={isExpanded ? `${styles.card} ${styles.cardExpanded}` : styles.card}
    >
      <button
        type="button"
        className={styles.head}
        onClick={toggleExpand}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? `折叠 ${character.name}` : `展开 ${character.name}`}
      >
        <span className={styles.imageBox}>
          {imageUrl.length > 0 && (
            <img
              src={imageUrl}
              alt={character.name}
              className={styles.image}
              draggable={false}
            />
          )}
          <span className={styles.overlay} aria-hidden="true" />
          <span className={styles.name}>{character.name}</span>
        </span>
      </button>

      {isExpanded && (
        <div className={styles.body}>
          <div className={styles.instructionsBlock}>
            <span className={styles.instructionsLabel}>INSTRUCTIONS</span>
            {hasInstructions ? (
              <p className={styles.instructionsText}>{character.instructions}</p>
            ) : (
              <p className={styles.instructionsEmpty}>未填写</p>
            )}
          </div>

          <div className={styles.actions}>
            {isConfirmingDelete ? (
              <>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={handleCancelDelete}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={styles.btnDangerSolid}
                  onClick={handleConfirmDelete}
                >
                  确认删除
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.btnDanger}
                onClick={handleDeleteClick}
              >
                删除
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
