import { useCallback, useEffect, useState } from 'react'
import {
  deleteCharacter,
  listCharacters,
  type Character,
} from '../../storage/charactersDb'
import { CharacterCard } from './CharacterCard'
import { CharacterCreateForm } from './CharacterCreateForm'
import { NewCharacterCard } from './NewCharacterCard'
import styles from './CharacterDrawer.module.css'

/**
 * Character 库抽屉根容器。
 *
 * 职责：
 * - 抽屉外壳：受控 open / onClose props；动效沿用 :root tokens（--motion-base + --easing-standard），
 *   从左侧 translateX(-100%) 滑入，宽度沿用 --sidebar-width，与现有 HistoryDrawer 占位风格一致。
 *   不渲染 backdrop / scrim（minimal-refined 契约 + HistoryDrawer 同样不带）。
 * - 两态切换：默认 `'list'`；点 NewCharacterCard → `'create'`，顶部出现「← 返回 | 新建角色」；
 *   表单成功 / 取消 / 返回 → 回到 `'list'`。
 * - 数据来源：抽屉首次进入「list」态调 `listCharacters()` 拉一次。本组件不复用 `useCharacters` hook
 *   的原因——hook 在挂载时自动拉一次，会与「抽屉关闭后重置为 list 态」逻辑（unmount/remount 或
 *   show/hide）耦合得不干净；这里手动管列表 + 自己控制何时拉，行为可预期。
 * - 关闭后重置：抽屉关闭再次打开重置为 `'list'`。实现方式是父组件控制 `open` 后由本组件
 *   监听 open 边沿，从 false→true 时重置 view 与表单态。
 * - 删除：调 `deleteCharacter(id)` → 从内存列表过滤 → CharacterCard 自身 unmount 时会
 *   revoke 它持有的 object URL（T4 已内化），本容器不需要再维护 object URL 引用表。
 * - 错误处理：list / delete 失败 → console.error + 顶部错误条；不上报。
 *
 * 与 HistoryDrawer 的协议对齐：本组件接受 `open` / `onClose` 作为受控开关，与 T6 即将引入的
 * 「openDrawer = 'none' | 'history' | 'characters'」单值状态一致——父级把对应布尔传进来即可。
 */

export type CharacterDrawerProps = {
  /** 抽屉是否打开。受控。 */
  open: boolean
  /** 用户请求关闭（ESC / 顶部关闭按钮）。 */
  onClose: () => void
}

type View = 'list' | 'create'

export function CharacterDrawer({ open, onClose }: CharacterDrawerProps) {
  const [view, setView] = useState<View>('list')
  const [characters, setCharacters] = useState<Character[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false)
  const [listError, setListError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const loadList = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setListError(null)
    try {
      const list = await listCharacters()
      setCharacters(list)
      setHasLoadedOnce(true)
    } catch (e) {
      console.error('[CharacterDrawer] listCharacters failed', e)
      const msg = e instanceof Error ? e.message : String(e)
      setListError(`加载角色列表失败：${msg}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // open 由 false → true 时：
  //  1) 强制重置回 list 态（acceptance：抽屉关闭后再次打开重置为 list 态）
  //  2) 首次打开拉一次数据；后续打开沿用上次内存中的列表（同一会话内的乐观刷新足够）
  // open 由 true → false 时：清掉删除错误，避免下次打开仍残留
  useEffect(() => {
    if (open) {
      setView('list')
      if (!hasLoadedOnce) {
        void loadList()
      }
    } else {
      setDeleteError(null)
    }
  }, [open, hasLoadedOnce, loadList])

  // ESC 关闭：仅在 open 时挂监听，避免影响其他键盘交互
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const handleNewCharacterClick = () => {
    setView('create')
  }

  const handleBackToList = () => {
    setView('list')
  }

  const handleCreated = (character: Character) => {
    // 乐观刷新：新角色 createdAt 即 Date.now()，必然排在最前
    setCharacters((prev) => [character, ...prev])
    setView('list')
  }

  const handleDelete = async (id: string): Promise<void> => {
    setDeleteError(null)
    try {
      await deleteCharacter(id)
      // CharacterCard 自身 unmount 时会 revoke 它持有的 object URL（T4 已内化）
      setCharacters((prev) => prev.filter((c) => c.id !== id))
    } catch (e) {
      console.error('[CharacterDrawer] deleteCharacter failed', e, { id })
      const msg = e instanceof Error ? e.message : String(e)
      setDeleteError(`删除失败：${msg}`)
    }
  }

  const rootClassName =
    open ? `${styles.root} ${styles.rootOpen}` : styles.root

  return (
    <aside
      className={rootClassName}
      aria-label="角色库"
      aria-hidden={!open}
      // 关闭态下让抽屉内的所有交互不可达（视觉透出 + 不可点）
      // pointer-events 由 aria-hidden 推不出来，但配合 inert 浏览器支持不一，
      // 这里用 tabIndex=-1 在关闭时阻挡键盘进入，足够 MVP。
      tabIndex={open ? undefined : -1}
    >
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {view === 'create' && (
            <button
              type="button"
              className={styles.backBtn}
              onClick={handleBackToList}
              aria-label="返回列表"
            >
              ←
            </button>
          )}
          <span className={styles.title}>
            {view === 'list' ? '角色库' : '新建角色'}
          </span>
        </div>
        <div className={styles.headerRight}>
          {view === 'list' && (
            <span className={styles.badge}>
              {characters.length === 0 ? 'EMPTY' : String(characters.length)}
            </span>
          )}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭角色库抽屉"
          >
            ×
          </button>
        </div>
      </div>

      <div className={styles.body}>
        {listError !== null && view === 'list' && (
          <div className={styles.errorBanner} role="alert">
            {listError}
          </div>
        )}
        {deleteError !== null && view === 'list' && (
          <div className={styles.errorBanner} role="alert">
            {deleteError}
          </div>
        )}

        {view === 'list' && isLoading && characters.length === 0 ? (
          <div className={styles.loading}>LOADING…</div>
        ) : view === 'list' ? (
          <div className={styles.grid}>
            <NewCharacterCard onClick={handleNewCharacterClick} />
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : (
          <CharacterCreateForm
            onCreated={handleCreated}
            onCancel={handleBackToList}
          />
        )}
      </div>
    </aside>
  )
}
