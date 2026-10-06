import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { isNotFound } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { getAnnouncementDetailQueryOptions } from '@/apis/announcement/get-announcement-detail/query';

import { useAnnouncementPermission } from '../../hooks/useAnnouncementPermission';
import { AnnouncementDetailRoute, AnnouncementListRoute } from '../../routes';
import { AnnouncementDispatchSection } from './components/AnnouncementDispatchSection';
import { AnnouncementSettingsSection } from './components/AnnouncementSettingsSection';

/** 公告詳情：內容與狀態操作（編輯、送出、暫停、恢復、刪除）與發送紀錄（撤回）。 */
export default function AnnouncementDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { announcementId } = AnnouncementDetailRoute.useParams();
  const search = AnnouncementListRoute.useSearch();
  const permission = useAnnouncementPermission();
  const announcement = useQuery(getAnnouncementDetailQueryOptions(announcementId));

  // 關閉鈕、Esc、點遮罩都會被編輯中的 guard（AnnouncementSettingsSection）攔下；只有刪除後的關閉略過
  const close = (options?: { ignoreBlocker?: boolean }) =>
    void navigate({ to: AnnouncementListRoute.to, search, ...options });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={announcement.data?.title ?? t('announcement.detail.title')}
      size="lg"
      data-testid="announcement-detail-dialog"
      footer={
        <Button variant="primary" onClick={() => close()}>
          {t('common.close')}
        </Button>
      }
    >
      {announcement.isPending && <Skeleton height={160} />}
      {announcement.isError && (
        <QueryError
          error={announcement.error}
          onRetry={isNotFound(announcement.error) ? undefined : () => void announcement.refetch()}
          action={
            <Button onClick={() => close()} data-testid="announcement-detail-back">
              {t('announcement.detail.backToList')}
            </Button>
          }
          data-testid="announcement-detail-error"
        />
      )}
      {announcement.data && (
        <div className="flex flex-col gap-5">
          <AnnouncementSettingsSection
            // 換了一則公告時重設編輯中的草稿
            key={announcement.data.id}
            announcement={announcement.data}
            canUpdate={permission.canUpdate}
            canDelete={permission.canDelete}
            canPublish={permission.canPublish}
            onDeleted={() => close({ ignoreBlocker: true })}
          />
          <AnnouncementDispatchSection
            announcementId={announcementId}
            canRevoke={permission.canPublish}
          />
        </div>
      )}
    </Dialog>
  );
}
