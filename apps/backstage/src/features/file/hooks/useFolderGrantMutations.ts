import { useMutation } from '@tanstack/react-query';

import { getFileAccessRequestCreateMutationOptions } from '@/apis/file/create-file-access-request/mutation';
import { getFileFolderGrantDeleteMutationOptions } from '@/apis/file/delete-file-folder-grant/mutation';
import { getFileAccessRequestReviewMutationOptions } from '@/apis/file/review-file-access-request/mutation';
import { getFileFolderGrantSetMutationOptions } from '@/apis/file/set-file-folder-grant/mutation';
import { getFileFolderAccessUpdateMutationOptions } from '@/apis/file/update-file-folder-access/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

/**
 * 資料夾授權變了：資料夾清單的能力旗標、授權清單、檔案的能力都可能跟著變
 * （後端同樣推 `fileFolder update`，docs/rbac/07-resource-grants.md §9）。
 */
function invalidateFolderAccess(folderId: string): void {
  invalidateResources([{ resource: Resource.FILE_FOLDER, kind: 'update', id: folderId }]);
}

/** 新增或變更一筆授權；失敗（反提權、對象已刪除）以 toast 顯示。 */
export function useFolderGrantSetMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileFolderGrantSetMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateFolderAccess(params.folderId);
      toast.success(t('file.share.granted'));
    },
    onError: showError,
  });
}

/** 移除一筆直接授權。 */
export function useFolderGrantDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileFolderGrantDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateFolderAccess(params.folderId);
      toast.success(t('file.share.revoked'));
    },
    onError: showError,
  });
}

/** 中斷／恢復繼承（私人資料夾）。 */
export function useFolderInheritanceMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileFolderAccessUpdateMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateFolderAccess(params.folderId);
      toast.success(t('file.share.inheritChanged'));
    },
    onError: showError,
  });
}

/** 申請資料夾存取。已有待審時後端不另建，toast 說明「已經申請過」。 */
export function useFileAccessRequestMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileAccessRequestCreateMutationOptions(),
    onSuccess: ({ submitted }, { params }) => {
      invalidateFolderAccess(params.folderId);
      toast.success(t(submitted ? 'file.access.submitted' : 'file.access.alreadyPending'));
    },
    onError: showError,
  });
}

/** 資料夾管理者核准／駁回存取申請。 */
export function useFileAccessReviewMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileAccessRequestReviewMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateFolderAccess(params.folderId);
      invalidateResources([{ resource: Resource.APPROVAL, kind: 'update', id: params.requestId }]);
      toast.success(
        t(params.decision === 'approve' ? 'file.access.approved' : 'file.access.rejected'),
      );
    },
    onError: showError,
  });
}
