/**
 * usePlayUrlPool — 批量拉取 task 的 play_url，受并发上限与时效缓存约束。
 *
 * 行为契约（见 DESIGN.md「关键流程 3」「非功能性约束 - 性能」）：
 * - 入参 `ids`：当前需要首帧 URL 的 task id 列表
 * - 出参：`Map<id, { url?: string; status: 'idle' | 'loading' | 'ok' | 'error' }>`
 * - 全局并发上限 **6**；超额排队，前面完成（成功/失败）后才出队下一个
 * - 同一 id 的 URL **1 小时内**重用，不重新发请求；过期后被请求时再次去取
 * - 单项失败 → 该 id 状态 `'error'`，不阻塞队列里的其他项
 *
 * 缓存与并发池放在模块作用域，跨组件 / 跨路由共享，满足"切出切回 History 直接复用"。
 */
import { useEffect, useState } from 'react';
import { getPlayUrl } from '../api/client';

const MAX_CONCURRENCY = 6;
const URL_TTL_MS = 60 * 60 * 1000; // 1 小时

export type PlayUrlEntry = {
  url?: string;
  status: 'idle' | 'loading' | 'ok' | 'error';
};

type CacheEntry = { url: string; fetchedAt: number };

// ============== 模块级共享状态 ==============

/** 已成功取到、仍在 TTL 内的 URL 缓存。 */
const urlCache = new Map<string, CacheEntry>();

/** 当前每个 id 的状态；失败也记一笔，让重渲染时能立即把 'error' 透出。 */
const statusMap = new Map<string, PlayUrlEntry>();

/** 正在 in-flight 的 id → 它的 Promise。用于去重并发触发。 */
const inflight = new Map<string, Promise<void>>();

/** 等待出队的 id 队列（FIFO）。 */
const waitQueue: string[] = [];

/** 订阅者集合：每个挂载的 hook 实例的 forceRender。 */
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry && Date.now() - entry.fetchedAt < URL_TTL_MS;
}

function ensureRequested(id: string): void {
  // 1) 命中新鲜缓存：直接置 ok
  const cached = urlCache.get(id);
  if (isFresh(cached)) {
    const cur = statusMap.get(id);
    if (!cur || cur.status !== 'ok' || cur.url !== cached.url) {
      statusMap.set(id, { url: cached.url, status: 'ok' });
    }
    return;
  }
  if (cached) urlCache.delete(id); // 过期清掉

  // 2) 已在飞 / 已排队：不重复入队
  if (inflight.has(id)) return;
  if (waitQueue.includes(id)) return;

  // 3) 池未满 → 立刻发起；满 → 入队
  if (inflight.size < MAX_CONCURRENCY) {
    statusMap.set(id, { status: 'loading' });
    const p = (async () => {
      try {
        const res = await getPlayUrl(id);
        urlCache.set(id, { url: res.url, fetchedAt: Date.now() });
        statusMap.set(id, { url: res.url, status: 'ok' });
      } catch {
        statusMap.set(id, { status: 'error' });
      } finally {
        inflight.delete(id);
        // 完成后尝试出队
        while (inflight.size < MAX_CONCURRENCY && waitQueue.length > 0) {
          const next = waitQueue.shift()!;
          const c = urlCache.get(next);
          if (isFresh(c)) {
            statusMap.set(next, { url: c.url, status: 'ok' });
            continue;
          }
          ensureRequested(next);
        }
        notify();
      }
    })();
    inflight.set(id, p);
  } else {
    waitQueue.push(id);
    if (!statusMap.has(id)) statusMap.set(id, { status: 'loading' });
  }
}

/**
 * 给定 task id 列表，返回每个 id 的当前 URL / 状态。
 *
 * - 列表里出现新 id：立即触发或入队
 * - 列表里消失的 id：不取消已发请求（请求廉价，结果还能进缓存）；输出 Map 自然不再包含它
 * - 多个组件传同一 id：共享同一份请求与缓存
 */
export function usePlayUrlPool(ids: string[]): Map<string, PlayUrlEntry> {
  const [, setTick] = useState(0);

  useEffect(() => {
    const sub = () => setTick((n) => n + 1);
    subscribers.add(sub);
    return () => {
      subscribers.delete(sub);
    };
  }, []);

  useEffect(() => {
    for (const id of ids) ensureRequested(id);
    // ensureRequested 会同步更新 statusMap；触发一次重渲染让本 hook 实例读到 'loading'/'ok'
    setTick((n) => n + 1);
  }, [ids]);

  const out = new Map<string, PlayUrlEntry>();
  for (const id of ids) {
    const entry = statusMap.get(id);
    if (entry) {
      out.set(id, entry);
      continue;
    }
    const cached = urlCache.get(id);
    if (isFresh(cached)) out.set(id, { url: cached.url, status: 'ok' });
    else out.set(id, { status: 'idle' });
  }
  return out;
}
