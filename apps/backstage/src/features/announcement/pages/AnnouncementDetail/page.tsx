import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { getAnnouncementDetailQueryOptions } from '@/apis/announcement/get-announcement-detail/query';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Skeleton } from '@/components/Skeleton';
import { QueryError } from '@/core/components';
import { isNotFound } from '@/core/errors';
import { useTranslation } from '@/core/locales';

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

  const close = () => void navigate({ to: AnnouncementListRoute.to, search, ignoreBlocker: true });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={announcement.data?.title ?? t('announcement.detail.title')}
      size="lg"
      data-testid="announcement-detail-dialog"
      footer={
        <Button variant="primary" onClick={close}>
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
            <Button onClick={close} data-testid="announcement-detail-back">
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
            onDeleted={close}
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
