import { Icon } from '@b2b-system/ui/Icon';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { cn } from '@b2b-system/web-shared/utils';

import { useTranslation } from '../locales';
import { RealtimeStatus, useRealtimeStatus } from '../realtime';

const STATUS_LABEL_KEYS: Record<RealtimeStatus, string> = {
  [RealtimeStatus.CONNECTED]: 'realtime.status.connected',
  [RealtimeStatus.DISCONNECTED]: 'realtime.status.disconnected',
  [RealtimeStatus.DISABLED]: 'realtime.status.disabled',
};

const STATUS_COLORS: Record<RealtimeStatus, string> = {
  [RealtimeStatus.CONNECTED]: 'text-[var(--color-success-text)]',
  [RealtimeStatus.DISCONNECTED]: 'text-[var(--color-danger-text)]',
  [RealtimeStatus.DISABLED]: 'text-[var(--color-fg-muted)]',
};

/** 頂列的 WebSocket（即時推播）連線狀態；只顯示，不能操作。滑過顯示說明。 */
export function RealtimeStatusIndicator() {
  const { t } = useTranslation();
  const status = useRealtimeStatus();
  const label = t(STATUS_LABEL_KEYS[status]);

  return (
    <Tooltip content={label}>
      {/* <output> 本身是 live region：狀態改變時報讀 sr-only 的文字；只是顯示，不放進 Tab 順序 */}
      <output
        className={cn('inline-flex h-8 w-8 items-center justify-center', STATUS_COLORS[status])}
        data-testid="realtime-status"
        data-value={status}
      >
        <Icon name="wifi" size={16} />
        <span className="sr-only">{label}</span>
      </output>
    </Tooltip>
  );
}
