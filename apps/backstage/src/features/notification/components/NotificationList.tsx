import { Empty } from '@b2b-system/ui/Empty';
import { Spinner } from '@b2b-system/ui/Spinner';
import { VirtualList } from '@b2b-system/ui/VirtualList';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { NotificationFilter } from '@/apis/notification/types';

import { useNotificationList } from '../hooks/useNotificationList';
import { useOpenNotification } from '../hooks/useOpenNotification';
import { NotificationItem } from './NotificationItem';

interface NotificationListProps {
  filter: NotificationFilter;
  /** 鈴鐺關著時不抓列表。 */
  enabled?: boolean;
  /** 點了一則有連結的通知之後（例：關閉 Popover）。 */
  onNavigate?: () => void;
  /** 捲動容器的高度由呼叫端決定（VirtualList 的約定）。 */
  className?: string;
  'data-testid'?: string;
}

/** 鈴鐺的 Popover 與列表頁共用：虛擬捲動 ＋ keyset 無限捲動（沿用 `Select`／`Menu` 的 `VirtualList`）。 */
export function NotificationList({
  filter,
  enabled,
  onNavigate,
  className,
  'data-testid': testId,
}: NotificationListProps) {
  const { t } = useTranslation();
  const list = useNotificationList(filter, { enabled });
  const markRead = useOpenNotification();

  if (list.isError) {
    return (
      <QueryError error={list.error} onRetry={list.refetch} data-testid="notification-error" />
    );
  }
  if (list.isPending) {
    return (
      <div className="flex justify-center p-4" data-testid="notification-loading">
        <Spinner size={16} />
      </div>
    );
  }

  return (
    <VirtualList
      items={list.items}
      getKey={(item) => item.id}
      renderItem={(item) => (
        <NotificationItem
          notification={item}
          onOpen={(notification) => {
            markRead(notification);
            onNavigate?.();
          }}
          onMarkRead={markRead}
        />
      )}
      estimateSize={84}
      hasMore={list.hasMore}
      loading={list.isLoadingMore}
      onLoadMore={list.loadMore}
      emptyContent={
        <Empty
          title={filter === 'unread' ? t('notification.emptyUnread') : t('notification.empty')}
          data-testid="notification-empty"
        />
      }
      aria-label={t('notification.title')}
      // 分隔線畫在 li 上：最後一則不畫，才不會與 Popover 的頁尾或列表頁的外框疊成兩條
      classNames={{ item: 'border-b border-[var(--color-border)] last:border-b-0' }}
      className={className}
      data-testid={testId}
    />
  );
}
