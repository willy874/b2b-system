import { IconButton } from '@b2b-system/ui/Button';
import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Icon } from '@b2b-system/ui/Icon';
import type { IconName } from '@b2b-system/ui/Icon';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { formatDateTime, formatRelativeTime } from '@b2b-system/web-shared/date';
import { cn } from '@b2b-system/web-shared/utils';
import { Link } from '@tanstack/react-router';

import { useTranslation } from '../locales';
import type { ResolvedRouteLink } from '../route-link';

/** 一則通知翻譯好、解析好之後的內容：列與詳細內容的對話框共用。 */
export interface NotificationContent {
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
  /** 解析後的連結；undefined 沒有快速連結（docs/architecture/backend/15-notification.md §12.2 D3）。 */
  link: ResolvedRouteLink | undefined;
}

export interface NotificationRowProps extends NotificationContent {
  /** 點整列：打開詳細內容（每一則都可以點，不論有沒有連結）。 */
  onOpenDetail: () => void;
  /** 點了快速連結；換頁由連結本身處理。 */
  onFollowLink: () => void;
  /** 列尾的「標為已讀」：不打開詳細內容也能標為已讀。 */
  onMarkRead: () => void;
  /** 列尾的「刪除」；省略時沒有這個按鈕。 */
  onDelete?: () => void;
  /** 列表頁的批次勾選；省略時沒有勾選框（鈴鐺）。 */
  selection?: { checked: boolean; onCheckedChange: (checked: boolean) => void };
}

/**
 * 鈴鐺與通知列表的一列（兩個前端共用；docs/architecture/frontend/15-notification.md §2.1）：類型圖示、句子、補充、觸發者與相對時間。
 * 整列是按鈕，點了打開詳細內容；連結是列尾另外的快速連結（真正的 `<a>`，可中鍵開新分頁）。
 * 勾選框、整列按鈕、列尾的快速連結、「標為已讀」與「刪除」是兄弟元素：互動元素不互相包含。
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
  onOpenDetail,
  onFollowLink,
  onMarkRead,
  onDelete,
  selection,
}: NotificationRowProps) {
  const { t } = useTranslation();
  const markReadLabel = t('notificationRow.markRead');
  const followLinkLabel = t('notificationRow.followLink');
  const deleteLabel = t('notificationRow.delete');
  const time = (
    <time dateTime={createdAt} title={formatDateTime(createdAt)}>
      {formatRelativeTime(createdAt)}
    </time>
  );

  return (
    <div
      className={cn(
        'flex w-full items-start text-[var(--color-fg)] hover:bg-[var(--color-fill)] focus-within:bg-[var(--color-fill)]',
        !isRead && 'bg-[var(--color-fill-subtle)]',
      )}
      data-testid="notification-item"
      data-value={id}
      data-state={isRead ? 'read' : 'unread'}
    >
      {selection && (
        <span className="flex shrink-0 py-3.5 pl-4">
          <Checkbox
            checked={selection.checked}
            onCheckedChange={selection.onCheckedChange}
            aria-label={t('notificationRow.select', { message })}
            data-testid="notification-item-select"
          />
        </span>
      )}
      <button
        type="button"
        onClick={onOpenDetail}
        className="flex min-w-0 flex-1 cursor-pointer gap-3 border-0 bg-transparent px-4 py-3 text-left text-inherit outline-none"
        data-testid="notification-item-open"
      >
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
      </button>
      {(link || !isRead || onDelete) && (
        <span className="flex shrink-0 gap-1 py-2.5 pr-2">
          {link && (
            <Tooltip content={followLinkLabel}>
              <Link
                to={link.to}
                params={link.params}
                search={link.search}
                onClick={onFollowLink}
                aria-label={followLinkLabel}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-fg-muted)] hover:bg-[var(--color-fill-subtle)] hover:text-[var(--color-fg)]"
                data-testid="notification-item-link"
                data-value={id}
              >
                <Icon name="chevron-right" size={16} />
              </Link>
            </Tooltip>
          )}
          {!isRead && (
            <Tooltip content={markReadLabel}>
              <IconButton
                size="sm"
                aria-label={markReadLabel}
                onClick={onMarkRead}
                data-testid="notification-item-mark-read"
                data-value={id}
              >
                <Icon name="check" size={16} />
              </IconButton>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip content={deleteLabel}>
              <IconButton
                size="sm"
                aria-label={deleteLabel}
                onClick={onDelete}
                data-testid="notification-item-delete"
                data-value={id}
              >
                <Icon name="trash" size={16} />
              </IconButton>
            </Tooltip>
          )}
        </span>
      )}
    </div>
  );
}

/** 列表交給每一列的動作；app 的 `NotificationItem` 以 `bindNotificationRowActions` 接到 `NotificationRow`。 */
export interface NotificationRowActions<TItem> {
  /** 點整列：打開詳細內容（帶著翻譯好的內容，對話框直接顯示）。 */
  onOpenDetail: (item: TItem, content: NotificationContent) => void;
  /** 點了快速連結；換頁由連結本身處理。 */
  onFollowLink: (item: TItem) => void;
  onMarkRead: (item: TItem) => void;
  onDelete: (item: TItem) => void;
  /** 有給才有勾選框（列表頁；鈴鐺沒有）。 */
  onSelectedChange?: (item: TItem, selected: boolean) => void;
}

/** 把列表的動作綁到這一則，得到 `NotificationRow` 的回呼與勾選。 */
export function bindNotificationRowActions<TItem>(
  item: TItem,
  content: NotificationContent,
  actions: NotificationRowActions<TItem>,
  selected: boolean,
): Pick<
  NotificationRowProps,
  'onOpenDetail' | 'onFollowLink' | 'onMarkRead' | 'onDelete' | 'selection'
> {
  const { onSelectedChange } = actions;
  return {
    onOpenDetail: () => actions.onOpenDetail(item, content),
    onFollowLink: () => actions.onFollowLink(item),
    onMarkRead: () => actions.onMarkRead(item),
    onDelete: () => actions.onDelete(item),
    selection: onSelectedChange && {
      checked: selected,
      onCheckedChange: (checked) => onSelectedChange(item, checked),
    },
  };
}
