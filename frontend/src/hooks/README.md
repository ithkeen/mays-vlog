# `frontend/src/hooks/`

跨页面共享的自定义 React hook。

## 文件清单

| 文件 | 职责 |
|---|---|
| `usePlayUrlPool.ts` | 批量获取 task 的播放 URL，受**并发上限 6** 与 **1 小时 TTL 缓存**约束；供 History grid 的卡片首帧渲染使用 |

## `usePlayUrlPool(ids)`

```ts
function usePlayUrlPool(ids: string[]): Map<string, PlayUrlEntry>;

type PlayUrlEntry = {
  url?: string;
  status: 'idle' | 'loading' | 'ok' | 'error';
};
```

### 行为

- 对入参 `ids` 中**不在缓存里**的 id，调用 `GET /api/tasks/{id}/play_url`（复用 `api/client` 的 `getPlayUrl`）。
- **并发上限 6**：超过 6 个未完成请求时，新 id 进入 FIFO 等待队列；任一请求完成（成功或失败）后出队下一个。
- **1 小时缓存**：成功取到的 URL 落进模块级缓存（`fetchedAt + 3600_000ms`），TTL 内同一 id 被再次请求时直接命中缓存，**不发新请求**。过期后会被丢弃，下次请求重新去取。
- **失败不阻塞**：单项失败将该 id 标 `'error'`，对其他 id 的请求与队列无影响。
- 状态变更（请求完成、失败、出队）通过模块级订阅广播到所有挂载的 hook 实例，触发一次重渲染。

### 状态语义

- `idle`：hook 刚拿到这个 id 但同步路径里还未登记（极少出现的中间态，下个 tick 会变 `loading`）
- `loading`：正在请求中或在等待队列里
- `ok`：`url` 字段可用；该值在 1 小时内重用
- `error`：本次请求失败；当前实现下不会自动重试（statusMap 是模块级，重挂载不会清掉该项）

### 共享性

缓存、队列、in-flight 集合都在**模块作用域**：

- 多个组件同时请求同一 id 不会重复发请求
- 离开 History 页（hook 卸载）再回来 → 1 小时内的 URL 立即命中缓存，无网络请求

### 与 `api/client` 的关系

只依赖 `getPlayUrl(id)`；4xx/5xx 抛出的 `ApiError` 与网络错都被 catch 成 `'error'` 状态，**不向上传播**——调用方按 `status` 字段判断展示即可（DESIGN 错误处理里规定：失败 → 卡片背景退化为纯色占位）。

### 不做的事

- 不取消已发请求（请求廉价，结果仍可进缓存供下次复用）
- 不自动刷新（TTL 到点不会主动重取，要等下次被请求）
- 不重试失败项（在 hook 层不重试，避免无意义打 backend）
