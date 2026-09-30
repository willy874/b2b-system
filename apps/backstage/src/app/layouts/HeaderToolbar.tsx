import { useHeaderTools } from '@/core/toolbar';

/** 頂列的工具區：依使用者在偏好頁設定的順序，只渲染開啟的工具。 */
export function HeaderToolbar() {
  const tools = useHeaderTools();
  return (
    // `contents`：工具直接參與頂列的 flex 排版與間距
    <div className="contents" data-testid="header-toolbar">
      {tools.map(({ tool, visible }) => (visible ? <tool.Component key={tool.key} /> : null))}
    </div>
  );
}
