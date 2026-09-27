import { useMutation } from '@tanstack/react-query';

import { getFileDeleteMutationOptions } from '@/apis/file/delete-file/mutation';
import { getFileUpdateMutationOptions } from '@/apis/file/update-file/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { isAppError, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

/**
 * 改名：帶上畫面看到的 `version`（樂觀鎖）。別人搶先改過時後端回 `FILE_VERSION_CONFLICT`，
 * 這裡失效該檔案讓畫面拿到最新的名稱與版本，錯誤仍交給呼叫端（對話框顯示並保留輸入）。
 */
export function useFileRenameMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getFileUpdateMutationOptions(),
    onSuccess: (file) => {
      invalidateResources([{ resource: Resource.FILE, kind: 'update', id: file.id }]);
      toast.success(t('file.rename.success'));
    },
    onError: (error, { params }) => {
      if (isAppError(error) && error.code === 'FILE_VERSION_CONFLICT') {
        invalidateResources([{ resource: Resource.FILE, kind: 'update', id: params.fileId }]);
      }
    },
  });
}

export function useFileDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.FILE, kind: 'delete', id: params.fileId }]);
      toast.success(t('file.delete.success'));
    },
    onError: (error, { params }) => {
      // 別人已經刪掉了：結果相同，只是讓畫面跟上
      if (isAppError(error) && error.code === 'FILE_NOT_FOUND') {
        invalidateResources([{ resource: Resource.FILE, kind: 'delete', id: params.fileId }]);
      }
      showError(error);
    },
  });
}
