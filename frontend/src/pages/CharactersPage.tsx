import { PageHeader } from '../components/AppShell/PageHeader';

/**
 * CharactersPage 骨架——T1 仅渲染 PageHeader 占位。
 * grid 列表、NewCharacterCard、/characters/new 创建表单态切换留给后续 task。
 */
export function CharactersPage() {
  return (
    <>
      <PageHeader title="Characters" />
    </>
  );
}
