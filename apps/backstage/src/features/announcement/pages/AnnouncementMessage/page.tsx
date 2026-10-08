import { RichTextViewer } from '@b2b-system/ui/RichTextViewer';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { isNotFound } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAnnouncementMessageQueryOptions } from '@/apis/announcement/get-announcement-message/query';
import { invalidateResources, Resource } from '@/apis/resources';

import { AnnouncementMessageRoute } from '../../routes';

/**
 * 收件人看公告全文（站內通知 `announcement.published` 的連結；docs/architecture/backend/19-announcement.md §9.2 D4）。
 * 只需要登入。後端讀全文時把那則通知標為已讀，並推給自己的其他分頁；這個分頁自己的通知列表與未讀數也在這裡更新。
 * 沒收到、已被撤回或清除：後端回 404 `ANNOUNCEMENT_MESSAGE_NOT_FOUND`，顯示它的說明。
 */
export default function AnnouncementMessagePage() {
  const { t } = useTranslation();
  const { dispatchId } = AnnouncementMessageRoute.useParams();
  const message = useQuery(getAnnouncementMessageQueryOptions(dispatchId));
  const loadedId = message.data?.dispatchId;

  useEffect(() => {
    if (loadedId) invalidateResources([{ resource: Resource.NOTIFICATION, kind: 'update' }]);
  }, [loadedId]);

  return (
    <article
      className="mx-auto flex w-full max-w-3xl flex-col gap-4"
      data-testid="announcement-message-page"
    >
      {message.isPending && <Skeleton height={200} />}
      {message.isError && (
        <QueryError
          error={message.error}
          onRetry={isNotFound(message.error) ? undefined : () => void message.refetch()}
          data-testid="announcement-message-error"
        />
      )}
      {message.data && (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="m-0 text-xl font-semibold" data-testid="announcement-message-title">
              {message.data.title}
            </h1>
            <p className="m-0 text-sm text-[var(--color-fg-muted)]">
              {t('announcement.message.meta', {
                sender: message.data.sender?.displayName ?? t('announcement.message.unknownSender'),
                at: formatDateTime(message.data.sentAt),
              })}
            </p>
          </header>
          <RichTextViewer value={message.data.body} data-testid="announcement-message-body" />
        </>
      )}
    </article>
  );
}
