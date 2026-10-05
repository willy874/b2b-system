import { isVersionConflict, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getAnnouncementCreateMutationOptions } from '@/apis/announcement/create-announcement/mutation';
import { getAnnouncementDeleteMutationOptions } from '@/apis/announcement/delete-announcement/mutation';
import { getAnnouncementPauseMutationOptions } from '@/apis/announcement/pause-announcement/mutation';
import { getAnnouncementPublishMutationOptions } from '@/apis/announcement/publish-announcement/mutation';
import { getAnnouncementRestoreMutationOptions } from '@/apis/announcement/restore-announcement/mutation';
import { getAnnouncementResumeMutationOptions } from '@/apis/announcement/resume-announcement/mutation';
import { getAnnouncementDispatchRevokeMutationOptions } from '@/apis/announcement/revoke-announcement-dispatch/mutation';
import { getAnnouncementUpdateMutationOptions } from '@/apis/announcement/update-announcement/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

/** 建立草稿：錯誤由表單顯示，不彈 toast。 */
export function useAnnouncementCreateMutation() {
  return useMutation({
    ...getAnnouncementCreateMutationOptions(),
    onSuccess: (created) => {
      invalidateResources([{ resource: Resource.ANNOUNCEMENT, kind: 'create', id: created.id }]);
    },
  });
}

/**
 * 修改：帶編輯開始時的 `version`（樂觀鎖）。衝突時失效該公告讓畫面拿到最新版本，
 * 訊息交給表單（`VersionConflictAlert`）顯示。
 */
export function useAnnouncementUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getAnnouncementUpdateMutationOptions(),
    onSuccess: (announcement) => {
      invalidateResources([
        { resource: Resource.ANNOUNCEMENT, kind: 'update', id: announcement.id },
      ]);
      toast.success(t('announcement.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([
          { resource: Resource.ANNOUNCEMENT, kind: 'update', id: params.announcementId },
        ]);
      }
    },
  });
}

/** 送出、暫停、恢復：成功後 toast；錯誤（受眾是空的、時間已過、版本衝突）也以 toast 呈現。 */
function useActionMutation(
  options:
    | ReturnType<typeof getAnnouncementPublishMutationOptions>
    | ReturnType<typeof getAnnouncementPauseMutationOptions>
    | ReturnType<typeof getAnnouncementResumeMutationOptions>,
  successKey:
    | 'announcement.publish.success'
    | 'announcement.pause.success'
    | 'announcement.resume.success',
) {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...options,
    onSuccess: (announcement) => {
      invalidateResources([
        { resource: Resource.ANNOUNCEMENT, kind: 'update', id: announcement.id },
      ]);
      toast.success(t(successKey));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([
          { resource: Resource.ANNOUNCEMENT, kind: 'update', id: params.announcementId },
        ]);
      }
      showError(error);
    },
  });
}

export function useAnnouncementPublishMutation() {
  return useActionMutation(getAnnouncementPublishMutationOptions(), 'announcement.publish.success');
}

export function useAnnouncementPauseMutation() {
  return useActionMutation(getAnnouncementPauseMutationOptions(), 'announcement.pause.success');
}

export function useAnnouncementResumeMutation() {
  return useActionMutation(getAnnouncementResumeMutationOptions(), 'announcement.resume.success');
}

/** 還原：重新出現在列表，以 create 宣告（回收桶由依賴圖跟著失效）。 */
export function useAnnouncementRestoreMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getAnnouncementRestoreMutationOptions(),
    onSuccess: (announcement) => {
      invalidateResources([
        { resource: Resource.ANNOUNCEMENT, kind: 'create', id: announcement.id },
      ]);
      toast.success(t('announcement.restore.success', { title: announcement.title }));
    },
    onError: showError,
  });
}

/** 刪除＝進回收桶：提示帶「復原」（回收桶被平台關掉時沒有，docs/architecture/05-tenancy.md §12.2 D3）。 */
export function useAnnouncementDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const restore = useAnnouncementRestoreMutation();
  const canRestore = useIsFeatureReady(TenantFeature.trash);

  return useMutation({
    ...getAnnouncementDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.ANNOUNCEMENT, kind: 'delete', id: params.announcementId },
      ]);
      toast.show({
        type: 'success',
        title: t('announcement.delete.success'),
        ...(canRestore && {
          action: {
            label: t('announcement.delete.undo'),
            onClick: () => restore.mutate({ params: { announcementId: params.announcementId } }),
          },
        }),
      });
    },
    onError: showError,
  });
}

/** 撤回一次發送：收件人的通知被刪除，發送紀錄保留（docs/architecture/backend/19-announcement.md §9.2 D18）。 */
export function useAnnouncementDispatchRevokeMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getAnnouncementDispatchRevokeMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.ANNOUNCEMENT, kind: 'update', id: params.announcementId },
      ]);
      toast.success(t('announcement.revoke.success'));
    },
    onError: showError,
  });
}
