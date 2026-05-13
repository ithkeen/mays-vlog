/**
 * Character 库前端持久化层（IndexedDB）。
 *
 * - object store：`characters`（schema 定义在 `historyDb.ts` 的 `AppDbSchema`）
 * - 主键 `id`：`crypto.randomUUID()` 生成
 * - 索引：
 *   - `by_created_at` on `createdAt`（按创建时间倒序拉列表）
 *   - `by_name_key` on `nameKey`（**unique**，存 `name.trim().toLowerCase()`）
 * - 参考图以 `Blob` 存原始字节；MIME 限 `image/png` / `image/jpeg` / `image/webp`
 *
 * 错误：
 * - `EmptyNameError`：name trim 后为空
 * - `DuplicateNameError`：nameKey 已存在
 * - `InvalidImageError`：image MIME 不在允许集合
 * - IDB 底层错误直接透传（DOMException）
 *
 * DB 入口（`video-mvp` + 版本 + `onUpgradeNeeded`）统一由 `historyDb.ts` 持有，
 * 本文件 import 其 `getDb` 复用；不在本文件重复 schema 定义，避免双写漂移。
 */

import { useCallback, useEffect, useState } from 'react'
import { getDb, type CharacterRecord } from './historyDb'

/** 对外暴露的 Character 实体；与 IDB 存储结构一致。 */
export type Character = CharacterRecord

/** 创建角色入参。 */
export type CreateCharacterInput = {
  name: string
  instructions?: string
  image: Blob
}

const STORE_NAME = 'characters'
const INDEX_CREATED_AT = 'by_created_at'
const INDEX_NAME_KEY = 'by_name_key'

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
])

export class EmptyNameError extends Error {
  constructor(message = 'name 不能为空') {
    super(message)
    this.name = 'EmptyNameError'
  }
}

export class DuplicateNameError extends Error {
  constructor(message = '已存在同名角色') {
    super(message)
    this.name = 'DuplicateNameError'
  }
}

export class InvalidImageError extends Error {
  constructor(message = '图片格式必须是 png / jpeg / webp') {
    super(message)
    this.name = 'InvalidImageError'
  }
}

/** 取全部角色，按 `createdAt` DESC（最新在前）。通过 `by_created_at` 反向游标实现。 */
export async function listCharacters(): Promise<Character[]> {
  const db = await getDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const result: Character[] = []
  let cursor = await tx.store.index(INDEX_CREATED_AT).openCursor(null, 'prev')
  while (cursor) {
    result.push(cursor.value)
    cursor = await cursor.continue()
  }
  await tx.done
  return result
}

/**
 * 创建角色。
 *
 * 校验顺序：name trim → image MIME → nameKey 唯一性（在事务内查 index）。
 * 通过则用 `crypto.randomUUID()` 生成 id，写入 IDB，返回完整 `Character`。
 *
 * nameKey 唯一性双重保险：先在 readwrite 事务内查 `by_name_key`，命中就抛
 * `DuplicateNameError`；即使有并发漏检，IDB 的 unique 索引也会让 `add` 失败
 * （透传为 DOMException）。
 */
export async function createCharacter(
  input: CreateCharacterInput,
): Promise<Character> {
  const name = input.name.trim()
  if (name.length === 0) {
    throw new EmptyNameError()
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(input.image.type)) {
    throw new InvalidImageError()
  }
  const nameKey = name.toLowerCase()

  const db = await getDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const existing = await tx.store.index(INDEX_NAME_KEY).getKey(nameKey)
  if (existing !== undefined) {
    // 主动放弃事务，避免无意义的空写阻塞后续操作
    tx.abort()
    throw new DuplicateNameError()
  }
  const record: Character = {
    id: crypto.randomUUID(),
    name,
    nameKey,
    instructions: input.instructions,
    image: input.image,
    createdAt: Date.now(),
  }
  await tx.store.add(record)
  await tx.done
  return record
}

/** 删除角色；id 不存在 IDB 本身幂等，不抛错。 */
export async function deleteCharacter(id: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE_NAME, id)
}

/**
 * React hook：暴露 characters 列表 + refresh / create / remove 操作。
 *
 * - 挂载时立刻 `listCharacters` 拉一次；失败把 error 暴露给调用方
 * - `create`：调 `createCharacter`，成功后把新行 prepend 到内存列表（乐观刷新，
 *   避免再次跑一次 cursor 查询）；失败抛出原始 error 让调用方区分
 * - `remove`：调 `deleteCharacter`，成功后从内存列表过滤掉对应 id
 * - `refresh`：强制重读 IDB 全量；用于外部数据变化（暂未使用，但作为对外契约保留）
 *
 * 与 history 现有惯例（`HistoryDrawer` 直接在组件里 `useState + useEffect`）相比，
 * Character 库没有「跨设备权威源」需要 merge，本地即权威；把数据 + 操作收敛进单个
 * hook 更紧凑，避免抽屉组件里散落重复的 try/catch + setState 模板。
 */
export function useCharacters(): {
  characters: Character[]
  isLoading: boolean
  error: Error | null
  refresh: () => Promise<void>
  create: (input: CreateCharacterInput) => Promise<Character>
  remove: (id: string) => Promise<void>
} {
  const [characters, setCharacters] = useState<Character[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    try {
      const list = await listCharacters()
      setCharacters(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (input: CreateCharacterInput): Promise<Character> => {
      const created = await createCharacter(input)
      // 乐观刷新：新角色 createdAt 即 Date.now()，必然排在最前
      setCharacters((prev) => [created, ...prev])
      return created
    },
    [],
  )

  const remove = useCallback(async (id: string): Promise<void> => {
    await deleteCharacter(id)
    setCharacters((prev) => prev.filter((c) => c.id !== id))
  }, [])

  return { characters, isLoading, error, refresh, create, remove }
}
