import { Empty } from '@b2b-system/ui/Empty';
import { Spinner } from '@b2b-system/ui/Spinner';
import { useTableSelection } from '@b2b-system/ui/Table';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import {
  NotificationBatchBar,
  toggleNotificationSelection,
} from '@b2b-system/web-core/notification';
import type {
  NotificationContent,
  NotificationRowActions,
} from '@b2b-system/web-core/notification';
import { cn } from '@b2b-system/web-shared/utils';

import { notificationMessage } from '../adapter';
import type { NotificationVM } from '../adapter';
import { NotificationBatchOperation } from '../batch';
import { useDeleteNotification } from '../hooks/useDeleteNotification';
import { useOpenNotification } from '../hooks/useOpenNotification';
import { NotificationItem } from './NotificationItem';

interface NotificationListProps {
  items: NotificationVM[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  unreadOnly: boolean;
  /** 點了一則：打開詳細內容（對話框由呼叫端渲染，鈴鐺要先關 Popover）。 */
  onOpenDetail: (content: NotificationContent) => void;
  /** 點了快速連結之後（例：關閉 Popover）。 */
  onNavigate?: () => void;
  /** 列表頁：每一則有勾選框，勾選後可以批次標為已讀、刪除（這一頁的）。 */
  selectable?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** 批次在全域佇列裡的識別：這個列表送出的工作進行中時，操作列換成進度條。 */
const BATCH_SCOPE = 'platform-notification-list';

const getNotificationId = (notification: NotificationVM) => notification.id;

/**
 * 鈴鐺的 Popover 與列表頁共用。平台的通知量很小（一頁最多 100 則），不需要 backstage 的虛擬捲動與無限捲動。
 */
export function NotificationList({
  items,
  loading,
  error,
  onRetry,
  unreadOnly,
  onOpenDetail,
  onNavigate,
  selectable = false,
  className,
  'data-testid': testId,
}: NotificationListProps) {
  const { t } = useTranslation();
  const markRead = useOpenNotification();
  const deleteNotification = useDeleteNotification();
  const selection = useTableSelection(items, getNotificationId);
  const selected = new Set(selection.selectedIds);
  const actions: NotificationRowActions<NotificationVM> = {
    onOpenDetail: (notification, content) => {
      markRead(notification);
      onOpenDetail(content);
    },
    onFollowLink: (notification) => {
      markRead(notification);
      onNavigate?.();
    },
    onMarkRead: markRead,
    onDelete: (notification) => deleteNotification(notification.id),
    onSelectedChange: selectable
      ? (notification, checked) => toggleNotificationSelection(selection, notification.id, checked)
      : undefined,
  };

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

  const list = (
    <ul
      aria-label={t('notification.title')}
      className={cn('m-0 list-none overflow-y-auto p-0', className)}
      data-testid={testId}
    >
      {items.map((item) => (
        <li key={item.id} className="border-b border-[var(--color-border)] last:border-b-0">
          <NotificationItem
            notification={item}
            actions={actions}
            selected={selected.has(item.id)}
          />
        </li>
      ))}
    </ul>
  );
  if (!selectable) return list;

  return (
    <div className="flex flex-col gap-2">
      <NotificationBatchBar
        scope={BATCH_SCOPE}
        items={items}
        selection={selection}
        getLabel={(notification) => notificationMessage(t, notification)}
        operations={{
          markRead: NotificationBatchOperation.MARK_READ,
          delete: NotificationBatchOperation.DELETE,
        }}
      />
      {list}
    </div>
  );
}
