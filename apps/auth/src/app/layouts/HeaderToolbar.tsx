import { IconButton } from '@/components/Button';
import { BoxEllipsis } from '@/components/Ellipsis';
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import { useTranslation } from '@/core/locales';
import { useHeaderTools } from '@/core/toolbar';

/**
 * 頂列的工具區：依使用者在偏好頁設定的順序，只渲染開啟的工具。
 * 頂列放不下時（窄螢幕、工具很多），從尾端把工具收進「更多」彈層；工具在彈層裡照常運作。
 */
export function HeaderToolbar() {
  const { t } = useTranslation();
  const tools = useHeaderTools().filter(({ visible }) => visible);
  return (
    // 佔滿頂列剩下的寬度並靠右，才量得到還能放幾個工具
    <BoxEllipsis
      className="flex-1 justify-end"
      data-testid="header-toolbar"
      renderOverflow={({ visibleCount }) => (
        <Popover
          align="end"
          trigger={
            <IconButton aria-label={t('common.more')} data-testid="header-toolbar-more">
              <Icon name="more" size={16} />
            </IconButton>
          }
          data-testid="header-toolbar-overflow"
        >
          <div className="flex flex-wrap items-center gap-2">
            {tools.slice(visibleCount).map(({ tool }) => (
              <tool.Component key={tool.key} />
            ))}
          </div>
        </Popover>
      )}
    >
      {tools.map(({ tool }) => (
        <tool.Component key={tool.key} />
      ))}
    </BoxEllipsis>
  );
}
