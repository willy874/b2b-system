import { Empty } from '@/components/Empty';
import { Spinner } from '@/components/Spinner';
import { QueryError } from '@/core/components';
import { useTranslation } from '@/core/locales';
import { cn } from '@/shared/utils';

import type { NotificationVM } from '../adapter';
import { useOpenNotification } from '../hooks/useOpenNotification';
import { NotificationItem } from './NotificationItem';

interface NotificationListProps {
  items: NotificationVM[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  unreadOnly: boolean;
  /** 點了一則有連結的通知之後（例：關閉 Popover）。 */
  onNavigate?: () => void;
  className?: string;
  'data-testid'?: string;
}

/**
 * 鈴鐺的 Popover 與列表頁共用。平台的通知量很小（一頁最多 100 則），不需要 backstage 的虛擬捲動與無限捲動。
 */
export function NotificationList({
  items,
  loading,
  error,
  onRetry,
  unreadOnly,
  onNavigate,
  className,
  'data-testid': testId,
}: NotificationListProps) {
  const { t } = useTranslation();
  const markRead = useOpenNotification();

  if (error) {
    return <QueryError error={error} onRetry={onRetry} data-testid="notification-error" />;
  }
  if (loading) {
    return (
      <div className="flex justify-center p-4" data-testid="notification-loading">
        <Spinner size={16} />
      </div>
    );
  }
  if (!items.length) {
    return (
      <Empty
        title={unreadOnly ? t('notification.emptyUnread') : t('notification.empty')}
        data-testid="notification-empty"
      />
    );
  }

  return (
    <ul
      aria-label={t('notification.title')}
      className={cn('m-0 list-none overflow-y-auto p-0', className)}
      data-testid={testId}
    >
      {items.map((item) => (
        <li key={item.id} className="border-b border-[var(--color-border)] last:border-b-0">
          <NotificationItem
            notification={item}
            onOpen={(notification) => {
              markRead(notification);
              onNavigate?.();
            }}
          />
        </li>
      ))}
    </ul>
  );
}
