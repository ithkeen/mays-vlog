import { useLocation, useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/AppShell/PageHeader'
import { CharacterCard } from '../components/character/CharacterCard'
import { NewCharacterCard } from '../components/character/NewCharacterCard'
import { CharacterCreateForm } from '../components/character/CharacterCreateForm'
import { useCharacters } from '../storage/charactersDb'
import styles from './CharactersPage.module.css'

/**
 * Characters 页：grid 卡列表 + 内嵌创建表单态。
 *
 * 布局：
 * - 顶部 `PageHeader title="Characters"`。
 * - 主体 grid：`auto-fill minmax(260px, 1fr)`，`grid-auto-rows` 跟列宽（aspect 1:1
 *   的卡视觉），`gap` 用 token。
 * - 首位永远是 `NewCharacterCard`，其后是真实角色卡。空态自然只剩占位卡。
 *
 * `/characters/new` 表单态：
 * - 检测到 pathname === '/characters/new' 时，在 grid 下方追加面板渲染
 *   `CharacterCreateForm`，并自动滚动进入视野——保留 grid 让用户的「我现在站在
 *   Characters 页」上下文不丢失，符合「不弹 modal、不跳页」基调。
 * - 表单 `onCreated` / `onCancel` 都 navigate 回 `/characters`，触发表单卸载。
 *
 * 数据：
 * - 用 `useCharacters` 拿列表 / 删除；
 * - 创建走表单内部的 `createCharacter`，成功后 `refresh()` 重读 IDB（form 不依赖 hook，
 *   走最稳的"以 IDB 为准"重读，避免乐观插入与 hook 内部状态不一致）。
 */
export function CharactersPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { characters, isLoading, error, refresh, remove } = useCharacters()

  const isCreating = location.pathname === '/characters/new'

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await remove(id)
    } catch (e) {
      // 失败不阻塞 UI；下次列表 refresh 仍以 IDB 为准
      console.error('[CharactersPage] delete failed', e)
    }
  }

  const handleCreated = () => {
    void refresh()
    navigate('/characters')
  }

  const handleCancel = () => {
    navigate('/characters')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Characters" />

      <div className={styles.body}>
        {error !== null && (
          <div className={styles.errorBanner} role="alert">
            加载失败：{error.message}
          </div>
        )}

        <div className={styles.grid}>
          <NewCharacterCard />
          {characters.map((c) => (
            <CharacterCard key={c.id} character={c} onDelete={handleDelete} />
          ))}
        </div>

        {isLoading && characters.length === 0 && (
          <div className={styles.loading}>LOADING…</div>
        )}

        {isCreating && (
          <section className={styles.formPanel} aria-label="新建角色">
            <h2 className={styles.formTitle}>新建角色</h2>
            <CharacterCreateForm
              onCreated={handleCreated}
              onCancel={handleCancel}
            />
          </section>
        )}
      </div>
    </div>
  )
}
