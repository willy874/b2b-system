import { useMutation } from '@tanstack/react-query';

import { getFileDeleteMutationOptions } from '@/apis/file/delete-file/mutation';
import { getFileRestoreMutationOptions } from '@/apis/file/restore-file/mutation';
import { getFileUpdateMutationOptions } from '@/apis/file/update-file/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { isAppError, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

import { CAN_UNDO_FILE_DELETE } from '../constants';

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

/**
 * 刪除檔案。刪除只是移到回收桶（ADR-0025 R4），但 R4a 的後端仍在刪除當下刪掉物件，還原一定是 `objectMissing`：
 * 所以「復原」等 R4b 部署後才打開（`CAN_UNDO_FILE_DELETE`）。刪除與還原的權限相同，刪得掉的人一定按得了。
 */
export function useFileDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const restore = useFileRestoreMutation();
  return useMutation({
    ...getFileDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.FILE, kind: 'delete', id: params.fileId }]);
      if (!CAN_UNDO_FILE_DELETE) {
        toast.success(t('file.delete.success'));
        return;
      }
      toast.show({
        type: 'success',
        title: t('file.delete.success'),
        action: {
          label: t('file.delete.undo'),
          onClick: () => restore.mutate({ params: { fileId: params.fileId } }),
        },
      });
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

/** `FILE_RESTORE_CONFLICT` 的原因（`details.reason`）→ 說明；其他原因退回通用訊息。 */
const FILE_RESTORE_CONFLICT_KEY = {
  parentDeleted: 'file.restore.parentDeleted',
  objectMissing: 'file.restore.objectMissing',
} as const;

function restoreConflictKeyOf(error: unknown): string | undefined {
  if (!isAppError(error) || error.code !== 'FILE_RESTORE_CONFLICT') return undefined;
  const reason = error.details?.reason;
  return reason === 'parentDeleted' || reason === 'objectMissing'
    ? FILE_RESTORE_CONFLICT_KEY[reason]
    : undefined;
}

/**
 * 還原刪除的檔案（`POST /files/:id/restore`，ADR-0025 R4）。所在的資料夾已刪除時提示先還原資料夾；
 * 物件已不在時說明無法救回（R4a 個別刪除的檔案都是這樣）。
 */
export function useFileRestoreMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileRestoreMutationOptions(),
    onSuccess: (file) => {
      // 重新出現在列表：以 create 宣告（回收桶由依賴圖跟著失效）；不帶所在資料夾，列表一律重抓
      invalidateResources([{ resource: Resource.FILE, kind: 'create', id: file.id }]);
      toast.success(t('file.restore.success', { name: file.name }));
    },
    onError: (error) => {
      const key = restoreConflictKeyOf(error);
      if (key) toast.error(t(key));
      else showError(error);
    },
  });
}
