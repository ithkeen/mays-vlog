import { useEffect, useState } from 'react'
import type { Character } from '../../storage/charactersDb'
import styles from './CharacterCard.module.css'

/**
 * 角色展示卡。
 *
 * 视觉：与 NewCharacterCard 共用 1:1 主视觉区，确保网格列内卡片对齐；展开时
 * 卡片自身增高（网格自然容纳，无需 grid 调整）。
 *
 * 行为：
 * - 默认态：参考图（1:1 区域）+ 卡片底部一行 Name。
 * - 点击卡片头部（图 + Name 区）→ 原地内联展开，下方追加 Instructions 区与
 *   删除按钮；再次点击头部 → 折叠。
 * - 每张卡独立维护展开 state，多卡可并存展开。
 * - 删除二次确认：单按钮「删除」点击后，**就地**变态为「取消 | 确认删除」
 *   两个并排按钮；点确认 → `onDelete(id)`；点取消 → 回到普通展开态。
 * - 本组件**不**碰 IDB，删除通过 props 上抛。
 *
 * 资源：
 * - 用 `URL.createObjectURL(image)` 渲染参考图；组件 unmount 时
 *   `URL.revokeObjectURL` 释放。image Blob 引用变化时也释放旧 URL 重建新 URL。
 *
 * 可达性：
 * - 卡片头部是 `<button>`，键盘可达；展开态使用 `aria-expanded` 表达状态。
 * - 内层按钮使用 `stopPropagation`，避免点删除/取消同时触发折叠。
 */

export type CharacterCardProps = {
  character: Character
  /** 点击「确认删除」时由外部决定 IDB 删除与列表刷新；本组件不做实际删除。 */
  onDelete: (id: string) => void
}

export function CharacterCard({ character, onDelete }: CharacterCardProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<boolean>(false)

  // 为参考图维护 object URL；image Blob 引用变化时重建并释放旧 URL。
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
      // 折叠时把删除确认态一起重置，避免下次展开还停在确认态
      if (!next) {
        setIsConfirmingDelete(false)
      }
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
    <article className={styles.card}>
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
        </span>
        <span className={styles.name}>{character.name}</span>
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
