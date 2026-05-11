import { useEffect, useRef, useState } from 'react';
import { ApiError, getPlayUrl } from '../api/client';
import { useSubmitTask } from '../api/hooks';
import { putMany, type HistoryItem } from '../storage/historyDb';
import { PromptInput, type PromptInputSubmitPayload } from './PromptInput';
import { ProgressPanel } from './ProgressPanel';
import { VideoPlayer } from './VideoPlayer';
import styles from './SubmissionWorkspace.module.css';

export type SubmissionWorkspaceProps = {
  /** 用户点「再生成一个」时由 App 自增 key 重挂本组件，从而把所有内部状态重置回 idle。 */
  onResetRequested: () => void;
};

/**
 * 右侧主工作区——围绕一次「提交-生成-展示」生命周期：
 *
 *   idle / failure → 输入表单（+ 失败提示）
 *   submitting / running → 输入表单（disabled） + 生成中 spinner
 *   success → 视频播放 + 「再生成一个」入口（点击后由父级 remount 本组件，回到 idle）
 *
 * 副作用：
 * - success 终态时拉 play_url（一次），喂给 <video>
 * - success 终态时把这条记录写进 IndexedDB（含时间单位换算 + 可选 imageBase64/imageMimeType）
 * - failure 终态：不写 IndexedDB
 */
export function SubmissionWorkspace({
  onResetRequested,
}: SubmissionWorkspaceProps) {
  const { status, task, error, submit } = useSubmitTask();

  /** 用户上次提交带了什么图——success 时一并写入 IndexedDB。 */
  const [lastImage, setLastImage] = useState<{
    base64: string;
    mime: 'image/png' | 'image/jpeg';
  } | null>(null);

  /** 拉到的播放 URL。null = 还没拿到 / 拉失败。 */
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  /** play_url / IndexedDB 副作用的展示性错误（不影响视频播放本身的非阻塞兜底）。 */
  const [postSuccessError, setPostSuccessError] = useState<string | null>(null);

  /** 防止 success 副作用因 React 18 strict mode 双触发而重复写库。 */
  const persistedRef = useRef<string | null>(null);

  const handleSubmit = (payload: PromptInputSubmitPayload) => {
    setLastImage(
      payload.imageBase64 !== null && payload.imageMimeType !== null
        ? { base64: payload.imageBase64, mime: payload.imageMimeType }
        : null,
    );
    setPlayUrl(null);
    setPostSuccessError(null);
    persistedRef.current = null;
    void submit(payload.prompt, payload.imageBase64 ?? undefined);
  };

  // success 后：(1) 拉 play_url；(2) 写 IndexedDB（带时间换算）。
  useEffect(() => {
    if (status !== 'success' || task === null) return;
    if (persistedRef.current === task.id) return;
    persistedRef.current = task.id;

    let cancelled = false;

    void (async () => {
      // 1) play_url
      try {
        const { url } = await getPlayUrl(task.id);
        if (!cancelled) setPlayUrl(url);
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e);
        setPostSuccessError(`拉取播放链接失败：${msg}`);
      }

      // 2) IndexedDB（即使 play_url 失败，仍然要写库——记录已成功落库）
      if (cancelled) return;
      const finishedAtSec = task.finished_at ?? task.created_at;
      const item: HistoryItem = {
        id: task.id,
        prompt: task.prompt,
        hasImage: task.has_image,
        createdAt: task.created_at * 1000,
        finishedAt: finishedAtSec * 1000,
      };
      if (task.title !== null) item.title = task.title;
      if (lastImage !== null) {
        item.imageBase64 = lastImage.base64;
        item.imageMimeType = lastImage.mime;
      }
      try {
        await putMany([item]);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setPostSuccessError((prev) =>
          prev !== null
            ? `${prev}；同时本地缓存写入失败：${msg}`
            : `本地缓存写入失败：${msg}`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, task, lastImage]);

  // success 视图
  if (status === 'success' && task !== null) {
    return (
      <div className={styles.workspace}>
        <VideoPlayer
          url={playUrl}
          onNewSubmission={onResetRequested}
          fallbackMessage={postSuccessError ?? undefined}
        />
        <div className={styles.metaCard}>
          <span className={styles.metaLabel}>本次 prompt</span>
          <p className={styles.metaPrompt}>{task.prompt}</p>
        </div>
        {postSuccessError !== null && playUrl !== null && (
          <div className={styles.softError}>{postSuccessError}</div>
        )}
      </div>
    );
  }

  // idle / submitting / running / failure 视图
  const inputDisabled = status === 'submitting' || status === 'running';
  const submitLabel = inputDisabled ? '生成中…' : '生成视频';

  return (
    <div className={styles.workspace}>
      <PromptInput
        onSubmit={handleSubmit}
        disabled={inputDisabled}
        submitLabel={submitLabel}
      />
      <ProgressPanel status={status} error={error} />
    </div>
  );
}
