import { Icon } from '@b2b-system/ui/Icon';
import type { IconName } from '@b2b-system/ui/Icon';
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

/**
 * 三種狀態的圖示形狀都不同，不只靠顏色區分（WCAG 1.4.1）：
 * 中斷是異常，用警告；未啟用是刻意沒有開，用 wifi-off。
 */
const STATUS_ICONS: Record<RealtimeStatus, IconName> = {
  [RealtimeStatus.CONNECTED]: 'wifi',
  [RealtimeStatus.DISCONNECTED]: 'warning',
  [RealtimeStatus.DISABLED]: 'wifi-off',
};

/**
 * 頂列的 WebSocket（即時推播）連線狀態；只顯示，不能操作。滑過顯示說明。
 * 中斷時另外顯示簡短的文字：提示框只有滑鼠叫得出來，只用鍵盤的人也要看得到「列表不會即時更新」。
 */
export function RealtimeStatusIndicator() {
  const { t } = useTranslation();
  const status = useRealtimeStatus();
  const label = t(STATUS_LABEL_KEYS[status]);
  const isDisconnected = status === RealtimeStatus.DISCONNECTED;

  return (
    <Tooltip content={label}>
      {/* <output> 本身是 live region：狀態改變時報讀 sr-only 的文字；只是顯示，不放進 Tab 順序 */}
      <output
        className={cn(
          'inline-flex h-8 min-w-8 items-center justify-center gap-1',
          isDisconnected && 'px-2',
          STATUS_COLORS[status],
        )}
        data-testid="realtime-status"
        data-value={status}
        data-icon={STATUS_ICONS[status]}
      >
        <Icon name={STATUS_ICONS[status]} size={16} />
        {/* 報讀器念 sr-only 的完整說明；這段只給看得到的人，不重複念 */}
        {isDisconnected && (
          <span
            className="text-xs whitespace-nowrap"
            aria-hidden="true"
            data-testid="realtime-status-text"
          >
            {t('realtime.status.disconnectedShort')}
          </span>
        )}
        <span className="sr-only">{label}</span>
      </output>
    </Tooltip>
  );
}
