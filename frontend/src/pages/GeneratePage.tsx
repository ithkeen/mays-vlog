import { useState } from 'react';
import { PageHeader } from '../components/AppShell/PageHeader';
import { SubmissionWorkspace } from '../components/SubmissionWorkspace';

/**
 * GeneratePage——`/generate` 路由页面。
 *
 * 外层 PageHeader（title="Generate"）+ 内层 SubmissionWorkspace。
 * 通过自增 `resetKey` 让 SubmissionWorkspace remount，把内部状态机从 success 终态拉回 idle
 * （即「再生成一个」入口的实现）。
 *
 * 进度仅在本页面内可见——AppShell 用 display:none 保活本页，
 * 切到 History/Characters 再切回时，SubmissionWorkspace 内部 useSubmitTask 轮询不会被打断。
 */
export function GeneratePage() {
  const [resetKey, setResetKey] = useState(0);

  return (
    <>
      <PageHeader title="Generate" />
      <SubmissionWorkspace
        key={resetKey}
        onResetRequested={() => setResetKey((k) => k + 1)}
      />
    </>
  );
}
