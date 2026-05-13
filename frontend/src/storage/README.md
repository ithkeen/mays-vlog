# frontend/src/storage/

前端本地缓存层（IndexedDB）。

## 职责边界

- 缓存历史索引：后端 `GET /api/tasks` 列表的本地副本，供 UI 离线渲染 / 首屏即出列表。
- 缓存首帧图：`hasImage=true` 时同步存 raw base64 + MIME 类型，供「历史详情」回看首帧图（后端**不**存图字节）。
- 与后端列表合并：三分支策略（详见下文 `mergeFromBackend`）。
- 持有 Character 库的 `characters` object store schema 定义（store 操作由后续 `charactersDb.ts` 实现）。

**不**做的事：
- 不缓存视频字节（始终走后端按需签发的 play_url）。
- 不充当数据权威源——以后端 `GET /api/tasks` 为权威，本模块仅是本地缓存。
- 不直接处理网络请求（API client 是 `src/api/`，由 T9 实现）。

## 模块文件

- `historyDb.ts`：IndexedDB 封装（基于 `idb` 库）。**唯一**持有共享 `AppDbSchema` 类型、`DB_NAME` / `DB_VERSION` 常量与 `onUpgradeNeeded` 分级升级逻辑；导出 `getDb` 供其他 store 模块复用；暴露 history 的 store 操作 + 合并函数。
- `charactersDb.ts`：Character 库的 store 操作（`listCharacters` / `createCharacter` / `deleteCharacter`）+ React hook `useCharacters`；自定义错误类（`EmptyNameError` / `DuplicateNameError` / `InvalidImageError`）用于让调用方区分校验失败种类。DB 入口直接 import `historyDb.ts` 的 `getDb`，不重复 DB_NAME / DB_VERSION / upgrade 流，schema 单一真相源在 `historyDb.ts`。

## IndexedDB schema

- 数据库名：`video-mvp`（沿用，不改名以保证既有 history 数据不丢）
- 版本：`2`
- object store：
  - `history`
    - 主键 keyPath：`id`（string，后端 task UUID）
    - 索引 `finishedAt`（number，unix ms）：用于按完成时间倒序拉取全部
  - `characters`（v2 新增；属于 Character 库 cycle）
    - 主键 keyPath：`id`（string，UUID）
    - 索引 `by_created_at` on `createdAt`（number，epoch ms）：列表按创建时间倒序
    - 索引 `by_name_key` on `nameKey`（string，**unique**）：角色名查重键，存 `name.trim().toLowerCase()`

### `characters` value 结构（`CharacterRecord`）

```ts
type CharacterRecord = {
  id: string
  name: string                 // 展示名，保留原大小写
  nameKey: string              // name.trim().toLowerCase()，唯一索引键
  instructions?: string        // 自由文本
  image: Blob                  // 参考图本体（image/png|jpeg|webp）
  createdAt: number            // epoch ms
}
```

### 升级流（`onUpgradeNeeded`）

按 `oldVersion` 分级，不重建已存在的 store / 数据：
- `oldVersion < 1`：建 `history` store + `finishedAt` 索引
- `oldVersion < 2`：建 `characters` store + `by_created_at` / `by_name_key`（unique）索引

老用户从 v1 升 v2 时，`history` 既有数据不动；新用户从 v0 直装 v2 时按顺序走完两个分支。

### `history` value 结构（`HistoryItem`）

```ts
type HistoryItem = {
  id: string
  prompt: string
  hasImage: boolean
  title?: string
  createdAt: number       // unix ms
  finishedAt: number      // unix ms（同 index key）
  imageBase64?: string    // 仅 hasImage=true 时存在；raw base64，无 data: 前缀
  imageMimeType?: 'image/png' | 'image/jpeg'  // 与 imageBase64 同时写入
}
```

时间单位与后端不同：后端 `created_at` / `finished_at` 是 **unix 秒**（snake_case），本地是 **unix 毫秒**（camelCase）。`mergeFromBackend` 内做 ×1000 换算。

## 对外接口

| 函数 | 行为 |
|---|---|
| `putMany(items)` | 批量 `put`；存在则覆盖，不存在则插入；空数组直接返回 |
| `get(id)` | 取单条；不存在返回 `undefined` |
| `getAll()` | 取全部，按 `finishedAt` **DESC**（最新在前），通过 `finishedAt` index 反向游标实现 |
| `updateTitle(id, title)` | 更新单条 title；id 不存在则静默跳过 |
| `remove(id)` | 删除单条；幂等 |
| `clear()` | 清空整个 store |
| `mergeFromBackend(backendList)` | 见下文 |

### `mergeFromBackend(backendList: ApiHistoryItem[])`

`ApiHistoryItem` 形状对齐后端 `GET /api/tasks` 列表项（snake_case + unix 秒），目前在 `historyDb.ts` 内本地复刻；T9 落地后可改为从 `src/api/client.ts` 导入同名类型。

三分支处理：

1. **后端有 + 本地无** → 插入新行；`imageBase64` / `imageMimeType` 保持 `undefined`（后端不返这两个字段）
2. **后端有 + 本地有** → 用后端字段覆盖（包括 `title` 以后端为准）；`imageBase64` / `imageMimeType` 保留本地已存值
3. **后端无 + 本地有** → 从本地删除整条（含图字段）

三分支在同一个 IndexedDB readwrite 事务内完成；中途异常则整笔回滚，避免半成品状态。

## 使用示例

```ts
import { mergeFromBackend, getAll, putMany, updateTitle, remove } from './storage/historyDb'

// 应用启动 / 主界面挂载时：拉后端列表 → merge → 渲染本地视图
const backendList = await apiGetTasks()
await mergeFromBackend(backendList)
const items = await getAll()  // 已按 finishedAt DESC 排序

// 新任务成功后：直接写入（后端 unix 秒需 ×1000）
await putMany([{
  id, prompt,
  hasImage: true,
  createdAt: backendCreatedAt * 1000,
  finishedAt: backendFinishedAt * 1000,
  imageBase64,
  imageMimeType: 'image/png',
}])

// 重命名 / 删除（与后端 PATCH / DELETE 联动后调用）
await updateTitle(id, '新标题')
await remove(id)
```

## Character 库（`charactersDb.ts`）

### 对外接口

| 导出 | 行为 |
|---|---|
| `listCharacters()` | 取全部角色；按 `createdAt` **DESC**（最新在前），通过 `by_created_at` 反向游标实现 |
| `createCharacter({ name, instructions?, image })` | 校验 → 写 IDB → 返回完整 `Character`；见下文「校验与错误」 |
| `deleteCharacter(id)` | 删除单条；幂等（id 不存在不抛错） |
| `useCharacters()` | React hook；暴露 `characters` / `isLoading` / `error` / `refresh` / `create` / `remove` |
| `Character` | 实体类型，等价于 `historyDb.ts` 中的 `CharacterRecord` |
| `CreateCharacterInput` | `createCharacter` / `useCharacters().create` 入参类型 |
| `EmptyNameError` / `DuplicateNameError` / `InvalidImageError` | 自定义错误类（可被 `instanceof` 区分） |

### 校验与错误

`createCharacter` 按以下顺序校验，命中即抛：

1. `name.trim() === ''` → `EmptyNameError`
2. `image.type ∉ { 'image/png', 'image/jpeg', 'image/webp' }` → `InvalidImageError`
3. 同一个 readwrite 事务内查 `by_name_key` 命中 → `DuplicateNameError`
   （即使有并发漏检，IDB unique 索引也会让 `add` 失败，透传为 DOMException）

`nameKey = name.trim().toLowerCase()`；`name` 字段保留原大小写用于展示。

### `useCharacters` 用法

```ts
const { characters, isLoading, error, refresh, create, remove } = useCharacters()

// 挂载时自动拉一次；外部数据若有变化可手动 refresh
await refresh()

// create / remove 成功后乐观刷新内存列表，无需再调用 refresh
try {
  const c = await create({ name: 'Alice', instructions: '...', image: blob })
} catch (e) {
  if (e instanceof EmptyNameError) { /* ... */ }
  else if (e instanceof DuplicateNameError) { /* ... */ }
  else if (e instanceof InvalidImageError) { /* ... */ }
  else { throw e }
}

await remove(c.id)
```

- `characters`：当前内存列表，已按 `createdAt` DESC 排序
- `isLoading`：仅在 `refresh` 进行中为 `true`；`create` / `remove` 不切此标志（视调用方需要在 UI 层自己加局部 loading）
- `error`：`refresh` 过程的错误；`create` / `remove` 的错误**直接抛出**，不写入 `error` 字段，便于调用方按错误种类分支响应
- 与 history 现有惯例对齐：history 的消费组件（`HistoryPage`）直接在组件内用 `useState + useEffect` 管列表 + merge，因为它要做「以后端为权威源的三分支合并」；Character 库**没有跨设备权威源**，本地即权威，把数据 + 操作收敛进单个 hook 更紧凑——避免在消费组件里散落同样模板的 try/catch + setState。故选择「合入 `charactersDb.ts`」而非新建独立 hook 文件

## 依赖

- `idb`（npm 包）：jakearchibald/idb，对原生 IndexedDB API 的薄 promise 封装，附 TypeScript schema 支持。
