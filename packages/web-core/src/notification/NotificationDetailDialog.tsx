import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Icon } from '@b2b-system/ui/Icon';
import { formatDateTime, formatRelativeTime } from '@b2b-system/web-shared/date';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { useTranslation } from '../locales';
import type { NotificationContent } from './NotificationRow';

export interface NotificationDetailDialogProps {
  /** 要顯示的一則；undefined 時關閉。呼叫端保留打開當下的內容，列表重抓（標為已讀）不影響對話框。 */
  notification: NotificationContent | undefined;
  /** 關閉（含點了「前往」「刪除」之後）。 */
  onClose: () => void;
  /** 頁尾的「刪除」；省略時沒有這個按鈕。 */
  onDelete?: (notification: NotificationContent) => void;
}

/**
 * 一則通知的詳細內容（兩個前端共用；docs/architecture/frontend/15-notification.md §2.2）：
 * 完整的句子與補充（列上會截斷）、觸發者、完整時間；有連結時頁尾多一個「前往」，可刪除時多一個「刪除」。
 */
export function NotificationDetailDialog({
  notification,
  onClose,
  onDelete,
}: NotificationDetailDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // 關閉的動畫期間沿用上一則，標題與內容才不會先變空白
  const [last, setLast] = useState(notification);
  if (notification !== undefined && notification !== last) setLast(notification);
  const shown = notification ?? last;
  const link = shown?.link;

  return (
    <Dialog
      open={notification !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        <span className="flex items-start gap-3">
          {shown && (
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-brand)]"
            >
              <Icon name={shown.icon} size={16} />
            </span>
          )}
          <span className="pt-1">{shown?.message}</span>
        </span>
      }
      footer={
        <>
          {onDelete && shown && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => {
                onDelete(shown);
                onClose();
              }}
              data-testid="notification-detail-delete"
            >
              {t('notificationDetail.delete')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} data-testid="notification-detail-close">
            {t('common.close')}
          </Button>
          {link && (
            <Button
              onClick={() => {
                onClose();
                void navigate({ to: link.to, params: link.params, search: link.search });
              }}
              data-testid="notification-detail-link"
            >
              {t('notificationDetail.followLink')}
              <Icon name="chevron-right" size={16} />
            </Button>
          )}
        </>
      }
      data-testid="notification-detail-dialog"
    >
      {shown && (
        <div className="flex flex-col gap-4">
          {shown.details.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
              {shown.details.map((detail) => (
                <li key={detail} className="break-words">
                  {detail}
                </li>
              ))}
            </ul>
          )}
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {shown.actor !== undefined && (
              <>
                <dt className="text-[var(--color-fg-muted)]">{t('notificationDetail.actor')}</dt>
                <dd className="m-0" data-testid="notification-detail-actor">
                  {shown.actor}
                </dd>
              </>
            )}
            <dt className="text-[var(--color-fg-muted)]">{t('notificationDetail.time')}</dt>
            <dd className="m-0">
              <time dateTime={shown.createdAt}>{formatDateTime(shown.createdAt)}</time>
              <span className="text-[var(--color-fg-muted)]">
                {' '}
                {t('notificationDetail.relativeTime', {
                  time: formatRelativeTime(shown.createdAt),
                })}
              </span>
            </dd>
          </dl>
        </div>
      )}
    </Dialog>
  );
}
