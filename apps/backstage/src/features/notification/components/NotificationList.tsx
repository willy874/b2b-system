import { Empty } from '@b2b-system/ui/Empty';
import { Spinner } from '@b2b-system/ui/Spinner';
import { useTableSelection } from '@b2b-system/ui/Table';
import { VirtualList } from '@b2b-system/ui/VirtualList';
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
import { useMemo } from 'react';

import type { NotificationFilter } from '@/apis/notification/types';

import { translateMessage } from '../adapter';
import type { NotificationVM } from '../adapter';
import { NotificationBatchOperation } from '../batch';
import { useDeleteNotification } from '../hooks/useDeleteNotification';
import { useNotificationList } from '../hooks/useNotificationList';
import { useOpenNotification } from '../hooks/useOpenNotification';
import { NotificationItem } from './NotificationItem';

interface NotificationListProps {
  filter: NotificationFilter;
  /** 鈴鐺關著時不抓列表。 */
  enabled?: boolean;
  /** 點了一則：打開詳細內容（對話框由呼叫端渲染，鈴鐺要先關 Popover）。 */
  onOpenDetail: (content: NotificationContent) => void;
  /** 點了快速連結之後（例：關閉 Popover）。 */
  onNavigate?: () => void;
  /** 列表頁：每一則有勾選框，勾選後可以批次標為已讀、刪除。 */
  selectable?: boolean;
  /** 捲動容器的高度由呼叫端決定（VirtualList 的約定）。 */
  className?: string;
  'data-testid'?: string;
}

/** 批次在全域佇列裡的識別：這個列表送出的工作進行中時，操作列換成進度條。 */
const BATCH_SCOPE = 'notification-list';

const getNotificationId = (notification: NotificationVM) => notification.id;

/**
 * 鈴鐺的 Popover 與列表頁共用：虛擬捲動 ＋ keyset 無限捲動（沿用 `Select`／`Menu` 的 `VirtualList`）。
 * 打開詳細內容、點快速連結都會把未讀的標為已讀；列尾可以刪除。列表頁的批次標為已讀與刪除走全域佇列（`batch.ts`）。
 */
export function NotificationList({
  filter,
  enabled,
  onOpenDetail,
  onNavigate,
  selectable = false,
  className,
  'data-testid': testId,
}: NotificationListProps) {
  const { t, language } = useTranslation();
  const list = useNotificationList(filter, { enabled });
  const markRead = useOpenNotification();
  const deleteNotification = useDeleteNotification();
  const selection = useTableSelection(list.items, getNotificationId);
  const { selectedIds } = selection;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const actions = useMemo<NotificationRowActions<NotificationVM>>(
    () => ({
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
        ? (notification, checked) =>
            toggleNotificationSelection(selection, notification.id, checked)
        : undefined,
    }),
    [deleteNotification, markRead, onNavigate, onOpenDetail, selectable, selection],
  );

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

  const virtualList = (
    <VirtualList
      items={list.items}
      getKey={(item) => item.id}
      renderItem={(item) => (
        <NotificationItem
          notification={item}
          actions={actions}
          selected={selectedSet.has(item.id)}
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

  if (!selectable || list.items.length === 0) return virtualList;

  // 全選只涵蓋已載入的通知：沒載入的還不知道 id，往下捲動載入後再勾
  return (
    <div className="flex flex-col gap-2">
      <NotificationBatchBar
        scope={BATCH_SCOPE}
        items={list.items}
        selection={selection}
        getLabel={(notification) => translateMessage(t, language, notification.message)}
        operations={{
          markRead: NotificationBatchOperation.MARK_READ,
          delete: NotificationBatchOperation.DELETE,
        }}
      />
      {virtualList}
    </div>
  );
}
