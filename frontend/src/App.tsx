import { BrowserRouter } from 'react-router-dom';
import { AppShell } from './components/AppShell/AppShell';

/**
 * 应用根节点——接入 BrowserRouter，由 AppShell 承载 sidebar + 主区路由。
 *
 * 旧的 openDrawer 互斥抽屉模型在本 cycle 整体废弃，
 * Generate / History / Characters 改为 react-router-dom 一级路由，
 * 内部 keep-mounted 由 AppShell 负责。
 */
function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
