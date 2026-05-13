/**
 * 前端历史本地缓存（IndexedDB）。
 *
 * - object store: `history`，主键为后端 task id（string）
 * - index: `finishedAt`（unix ms），用于按完成时间倒序拉全部
 * - 仅缓存历史索引；视频本体走后端 play_url，不存视频字节
 * - 首帧图以 raw base64（无 data: 前缀）+ MIME 类型存储，供历史回看时重组 data: URL
 *
 * 与后端列表的合并策略遵循 PLAN T10 的三分支：
 *   1. 后端有 + 本地无 → 插入新行（无 imageBase64 / imageMimeType）
 *   2. 后端有 + 本地有 → 用后端字段覆盖（title 以后端为准），保留本地 imageBase64 / imageMimeType
 *   3. 后端无 + 本地有 → 从本地删除整条
 *
 * 时间单位：后端是 unix 秒（snake_case），本地是 unix 毫秒（camelCase），
 * mergeFromBackend 内部做 ×1000 换算。
 *
 * 数据库 schema：本文件持有共享 `video-mvp` 数据库的 schema 定义。除 `history`
 * store 外，还包含 Character 库的 `characters` store（详见 `charactersDb.ts`）。
 * `onUpgradeNeeded` 按 `oldVersion` 分级处理，保证已存在的 store / 数据不被重建。
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/** 本地缓存中的一条历史记录。 */
export type HistoryItem = {
  id: string
  prompt: string
  hasImage: boolean
  title?: string
  /** 提交时间，unix ms */
  createdAt: number
  /** 完成时间，unix ms（用作 index key） */
  finishedAt: number
  /** 仅 hasImage=true 时存在；raw base64，无 `data:` 前缀 */
  imageBase64?: string
  /** 与 imageBase64 同时写入，用于渲染 data: URL */
  imageMimeType?: 'image/png' | 'image/jpeg'
}

/**
 * 后端 `GET /api/tasks` 列表项的最小形状。
 *
 * 注意：字段是 snake_case，时间单位为 unix 秒；与本地 `HistoryItem` 不同。
 * T9 落地后可改为从 `src/api/client.ts` 导入；目前 T9 尚未交付，本地复刻。
 */
export type ApiHistoryItem = {
  id: string
  prompt: string
  title: string | null
  has_image: boolean
  created_at: number
  finished_at: number
}

/** Character 库实体；schema 与 `charactersDb.ts` 的 `Character` 类型对齐。 */
export type CharacterRecord = {
  id: string
  name: string
  nameKey: string
  instructions?: string
  image: Blob
  createdAt: number
}

export interface AppDbSchema extends DBSchema {
  history: {
    key: string
    value: HistoryItem
    indexes: { finishedAt: number }
  }
  characters: {
    key: string
    value: CharacterRecord
    indexes: {
      by_created_at: number
      by_name_key: string
    }
  }
}

const DB_NAME = 'video-mvp'
/** 当前 schema 版本；上轮 cycle 历史索引为 v1，本轮新增 characters store 升至 v2。 */
const DB_VERSION = 2
const STORE_NAME = 'history'
const INDEX_NAME = 'finishedAt'

let dbPromise: Promise<IDBPDatabase<AppDbSchema>> | null = null

/**
 * 打开共享 DB（history + characters）。本模块是 `video-mvp` DB 的唯一入口，
 * `charactersDb.ts` 等其他 store 模块直接 import 本函数复用，避免 schema 双写。
 *
 * 升级流按 `oldVersion` 分级：
 *   - v0 → v1：建 `history` store + `finishedAt` 索引（保留首次安装路径）
 *   - v1 → v2：建 `characters` store + `by_created_at` / `by_name_key`（unique）索引
 *
 * 因 `createObjectStore` 不影响其他 store 的既有数据，从 v1 升 v2 时 `history`
 * 数据原样保留；从 v0 直装到 v2 时按顺序走完两个分支。
 */
export function getDb(): Promise<IDBPDatabase<AppDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex(INDEX_NAME, 'finishedAt')
        }
        if (oldVersion < 2) {
          const store = db.createObjectStore('characters', { keyPath: 'id' })
          store.createIndex('by_created_at', 'createdAt')
          store.createIndex('by_name_key', 'nameKey', { unique: true })
        }
      },
    })
  }
  return dbPromise
}

/** 批量写入（覆盖已有同 id 行）。 */
export async function putMany(items: HistoryItem[]): Promise<void> {
  if (items.length === 0) return
  const db = await getDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  await Promise.all([...items.map((item) => tx.store.put(item)), tx.done])
}

/** 取单条；不存在返回 undefined。 */
export async function get(id: string): Promise<HistoryItem | undefined> {
  const db = await getDb()
  return db.get(STORE_NAME, id)
}

/** 取全部，按 finishedAt DESC（最新在前）。通过 finishedAt index 反向游标实现。 */
export async function getAll(): Promise<HistoryItem[]> {
  const db = await getDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const result: HistoryItem[] = []
  let cursor = await tx.store.index(INDEX_NAME).openCursor(null, 'prev')
  while (cursor) {
    result.push(cursor.value)
    cursor = await cursor.continue()
  }
  await tx.done
  return result
}

/** 更新单条 title；id 不存在则静默跳过。 */
export async function updateTitle(id: string, title: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const existing = await tx.store.get(id)
  if (existing) {
    await tx.store.put({ ...existing, title })
  }
  await tx.done
}

/** 删除单条；id 不存在不抛错（IndexedDB delete 本身幂等）。 */
export async function remove(id: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE_NAME, id)
}

/** 清空 store。 */
export async function clear(): Promise<void> {
  const db = await getDb()
  await db.clear(STORE_NAME)
}

/**
 * 以后端列表为权威源同步本地。
 *
 * 三分支严格按 PLAN T10：
 *   1. 后端有 + 本地无 → 插入新行（imageBase64 / imageMimeType 为 undefined）
 *   2. 后端有 + 本地有 → 后端字段覆盖（title 以后端为准），imageBase64 / imageMimeType 保留本地
 *   3. 后端无 + 本地有 → 从本地删除整条
 *
 * 三分支在同一个 readwrite 事务内完成；中途异常则整笔回滚。
 * 后端 unix 秒 × 1000 → 本地 unix ms。
 */
export async function mergeFromBackend(backendList: ApiHistoryItem[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')

  const backendMap = new Map<string, ApiHistoryItem>()
  for (const item of backendList) {
    backendMap.set(item.id, item)
  }

  const localItems = await tx.store.getAll()
  const localMap = new Map<string, HistoryItem>()
  for (const item of localItems) {
    localMap.set(item.id, item)
  }

  const ops: Promise<unknown>[] = []

  // 分支 1 & 2：遍历后端项
  for (const [id, backend] of backendMap) {
    const local = localMap.get(id)
    const next: HistoryItem = {
      id: backend.id,
      prompt: backend.prompt,
      hasImage: backend.has_image,
      createdAt: backend.created_at * 1000,
      finishedAt: backend.finished_at * 1000,
    }
    if (backend.title !== null) {
      next.title = backend.title
    }
    if (local) {
      // 分支 2：保留本地图字段
      if (local.imageBase64 !== undefined) {
        next.imageBase64 = local.imageBase64
      }
      if (local.imageMimeType !== undefined) {
        next.imageMimeType = local.imageMimeType
      }
    }
    // 分支 1 落入此处时不带图字段，符合 acceptance
    ops.push(tx.store.put(next))
  }

  // 分支 3：本地有但后端无的删除
  for (const id of localMap.keys()) {
    if (!backendMap.has(id)) {
      ops.push(tx.store.delete(id))
    }
  }

  await Promise.all(ops)
  await tx.done
}
