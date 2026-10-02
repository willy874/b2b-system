import { Link } from '@tanstack/react-router';
import { memo } from 'react';

import { useTranslation } from '@/core/locales';
import { formatDateTime, formatRelativeTime } from '@/shared/date';
import { cn } from '@/shared/utils';

import { translateMessage } from '../adapter';
import type { NotificationVM } from '../adapter';

interface NotificationItemProps {
  notification: NotificationVM;
  /** 點了有連結的一則（標為已讀）；換頁由連結本身處理。 */
  onOpen: (notification: NotificationVM) => void;
}

const ROW_CLASS =
  'flex w-full gap-3 px-3 py-2.5 text-left text-[var(--color-fg)] no-underline outline-none';

/**
 * 一則通知：句子、補充、由誰觸發與相對時間。有連結的是真正的 `<a>`（可中鍵開新分頁）；
 * route id 沒有登記或缺參數時只顯示文字、不可點（docs/architecture/backend/15-notification.md §12.2 D3）。
 */
export const NotificationItem = memo(function NotificationItem({
  notification,
  onOpen,
}: NotificationItemProps) {
  const { t, language } = useTranslation();
  const { isRead, link } = notification;

  const content = (
    <>
      {/* 未讀的圓點只給視覺；報讀靠下方的 sr-only 文字 */}
      <span
        aria-hidden
        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', !isRead && 'bg-[var(--color-brand)]')}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-sm', !isRead && 'font-semibold')}>
          {!isRead && <span className="sr-only">{t('notification.unread')}</span>}
          {translateMessage(t, language, notification.message)}
        </span>
        {notification.details.map((detail) => (
          <span key={detail.key} className="truncate text-xs text-[var(--color-fg-muted)]">
            {translateMessage(t, language, detail)}
          </span>
        ))}
        <span className="text-xs text-[var(--color-fg-muted)]">
          {notification.actorName ?? t('notification.actor.system')}
          {' · '}
          <time dateTime={notification.createdAt} title={formatDateTime(notification.createdAt)}>
            {formatRelativeTime(notification.createdAt)}
          </time>
        </span>
      </span>
    </>
  );

  if (!link) {
    return (
      <div
        className={ROW_CLASS}
        data-testid="notification-item"
        data-value={notification.id}
        data-state={isRead ? 'read' : 'unread'}
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      to={link.to}
      params={link.params}
      search={link.search}
      onClick={() => onOpen(notification)}
      className={cn(
        ROW_CLASS,
        'cursor-pointer hover:bg-[var(--color-fill-subtle)] focus-visible:bg-[var(--color-fill-subtle)]',
      )}
      data-testid="notification-item"
      data-value={notification.id}
      data-state={isRead ? 'read' : 'unread'}
      data-link
    >
      {content}
    </Link>
  );
});
