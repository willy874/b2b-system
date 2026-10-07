import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import type { IconName } from '@b2b-system/ui/Icon';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { formatDateTime, formatRelativeTime } from '@b2b-system/web-shared/date';
import { cn } from '@b2b-system/web-shared/utils';
import { Link } from '@tanstack/react-router';

import { useTranslation } from '../locales';
import type { ResolvedRouteLink } from '../route-link';

export interface NotificationRowProps {
  id: string;
  isRead: boolean;
  /** 依通知類型的圖示（app 的對照表），讓列表一眼看得出是哪一類事件。 */
  icon: IconName;
  /** 翻譯好的句子。 */
  message: string;
  /** 第二行起的補充，已翻譯；沒有就是空陣列。 */
  details: readonly string[];
  /** 觸發者的名稱（含「系統」）；undefined 不顯示（例：apps/platform 的通知沒有觸發者）。 */
  actor?: string;
  createdAt: string;
  /** 解析後的連結；undefined 只顯示文字、不可點（docs/architecture/backend/15-notification.md §12.2 D3）。 */
  link: ResolvedRouteLink | undefined;
  /** 點了有連結的一則；換頁由連結本身處理。 */
  onOpen: () => void;
  /** 列尾的「標為已讀」：沒有連結的通知也要能標為已讀。 */
  onMarkRead: () => void;
}

const ROW_CLASS =
  'flex w-full gap-3 px-4 py-3 text-left text-[var(--color-fg)] no-underline outline-none';

/**
 * 鈴鐺與通知列表的一列（兩個前端共用；docs/architecture/frontend/15-notification.md §2）：類型圖示、句子、補充、觸發者與相對時間。
 * 有連結的是真正的 `<a>`（可中鍵開新分頁）；未讀的列底色較深、句子加粗，列尾有「標為已讀」——與連結分開，`<a>` 裡不放按鈕。
 */
export function NotificationRow({
  id,
  isRead,
  icon,
  message,
  details,
  actor,
  createdAt,
  link,
  onOpen,
  onMarkRead,
}: NotificationRowProps) {
  const { t } = useTranslation();
  const markReadLabel = t('notificationRow.markRead');
  const time = (
    <time dateTime={createdAt} title={formatDateTime(createdAt)}>
      {formatRelativeTime(createdAt)}
    </time>
  );

  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]',
          isRead ? 'text-[var(--color-fg-muted)]' : 'text-[var(--color-brand)]',
        )}
      >
        <Icon name={icon} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn('text-sm leading-5', !isRead && 'font-semibold')}>
          {/* 未讀的底色與粗體只給視覺；報讀靠這段文字 */}
          {!isRead && <span className="sr-only">{t('notificationRow.unread')}</span>}
          {message}
        </span>
        {details.map((detail) => (
          <span key={detail} className="truncate text-xs leading-4 text-[var(--color-fg-muted)]">
            {detail}
          </span>
        ))}
        <span className="text-xs leading-4 text-[var(--color-fg-muted)]">
          {actor === undefined ? (
            time
          ) : (
            <>
              {actor}
              {' · '}
              {time}
            </>
          )}
        </span>
      </span>
    </>
  );

  // 未讀的列預留右側給「標為已讀」按鈕，文字不會被它蓋住
  const rowClass = cn(ROW_CLASS, !isRead && 'bg-[var(--color-fill-subtle)] pr-12');

  return (
    <div className="relative">
      {link ? (
        <Link
          to={link.to}
          params={link.params}
          search={link.search}
          onClick={onOpen}
          className={cn(
            rowClass,
            'cursor-pointer hover:bg-[var(--color-fill)] focus-visible:bg-[var(--color-fill)]',
          )}
          data-testid="notification-item"
          data-value={id}
          data-state={isRead ? 'read' : 'unread'}
          data-link
        >
          {content}
        </Link>
      ) : (
        <div
          className={rowClass}
          data-testid="notification-item"
          data-value={id}
          data-state={isRead ? 'read' : 'unread'}
        >
          {content}
        </div>
      )}
      {!isRead && (
        <Tooltip content={markReadLabel}>
          <IconButton
            size="sm"
            aria-label={markReadLabel}
            onClick={onMarkRead}
            className="absolute right-2 top-2.5"
            data-testid="notification-item-mark-read"
            data-value={id}
          >
            <Icon name="check" size={16} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}
