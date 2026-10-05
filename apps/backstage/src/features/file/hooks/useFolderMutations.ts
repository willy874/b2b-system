import { ANY_ID } from '@b2b-system/web-core/cache';
import { isAppError, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getFileFolderCreateMutationOptions } from '@/apis/file/create-file-folder/mutation';
import { getFileFolderDeleteMutationOptions } from '@/apis/file/delete-file-folder/mutation';
import { getFileMoveMutationOptions } from '@/apis/file/move-file-items/mutation';
import { getFileFolderRestoreMutationOptions } from '@/apis/file/restore-file-folder/mutation';
import { getFileFolderUpdateMutationOptions } from '@/apis/file/update-file-folder/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

/** 建立資料夾。錯誤（同名）交給呼叫端的對話框顯示並保留輸入。 */
export function useFolderCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getFileFolderCreateMutationOptions(),
    onSuccess: (folder) => {
      invalidateResources([{ resource: Resource.FILE_FOLDER, kind: 'create', id: folder.id }]);
      toast.success(t('file.folder.create.success'));
    },
  });
}

/** 資料夾改名。錯誤交給呼叫端的對話框。 */
export function useFolderRenameMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getFileFolderUpdateMutationOptions(),
    onSuccess: (folder) => {
      invalidateResources([{ resource: Resource.FILE_FOLDER, kind: 'update', id: folder.id }]);
      toast.success(t('file.rename.success'));
    },
  });
}

function invalidateDeletedFolder(folderId: string): void {
  invalidateResources([
    { resource: Resource.FILE_FOLDER, kind: 'delete', id: folderId },
    { resource: Resource.FILE, kind: 'delete', id: ANY_ID },
  ]);
}

/**
 * 遞迴刪除資料夾：子資料夾與其中的檔案一起消失，所以檔案的列表與詳情也要失效。
 * 刪除只是移到回收桶（docs/architecture/backend/14-revisions.md §9 R4），成功的提示附「復原」，按下就還原整批（同一次刪除的子資料夾與檔案）。
 */
export function useFolderDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const restore = useFolderRestoreMutation();
  const canRestore = useIsFeatureReady(TenantFeature.trash);
  return useMutation({
    ...getFileFolderDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateDeletedFolder(params.folderId);
      toast.show({
        type: 'success',
        title: t('file.folder.delete.success'),
        // 回收桶被平台關掉時還原端點回 404，不提供復原（docs/architecture/05-tenancy.md §12.2 D3）
        ...(canRestore && {
          action: {
            label: t('file.folder.delete.undo'),
            onClick: () => restore.mutate({ params: { folderId: params.folderId } }),
          },
        }),
      });
    },
    onError: (error, { params }) => {
      // 別人已經刪掉了：結果相同，只是讓畫面跟上
      if (isAppError(error) && error.code === 'FILE_FOLDER_NOT_FOUND')
        invalidateDeletedFolder(params.folderId);
      showError(error);
    },
  });
}

/**
 * 還原刪除的資料夾（`POST /file-folders/:id/restore`，docs/architecture/backend/14-revisions.md §9 R4）：同一次刪除的子資料夾與檔案一起回來。
 * 內容已不在的檔案不還原（`filesSkipped`），提示說明數量；同一個位置已有同名的資料夾時說明要先改名或移走它。
 * 上層已刪除（`FILE_FOLDER_RESTORE_CONFLICT`）用通用訊息：先還原上層。
 */
export function useFolderRestoreMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileFolderRestoreMutationOptions(),
    onSuccess: (folder) => {
      // 重新出現：以 create 宣告（回收桶由依賴圖跟著失效）；一起回來的檔案不知道 id，退回失效所有檔案
      invalidateResources([
        { resource: Resource.FILE_FOLDER, kind: 'create', id: folder.id },
        { resource: Resource.FILE, kind: 'create', id: ANY_ID },
      ]);
      if (folder.filesSkipped > 0) {
        toast.warning(
          t('file.folder.restore.partial', { name: folder.name, count: folder.filesSkipped }),
        );
      } else {
        toast.success(t('file.folder.restore.success', { name: folder.name }));
      }
    },
    onError: (error) => {
      if (isAppError(error) && error.code === 'FILE_FOLDER_NAME_CONFLICT') {
        toast.error(t('file.folder.restore.nameConflict'));
        return;
      }
      showError(error);
    },
  });
}

/**
 * 把檔案與資料夾移到另一個資料夾（拖放、移動對話框共用）。
 * 失敗（循環、同名、資料夾已被刪除）以 toast 顯示並重抓資料夾，讓畫面跟上別人的變更。
 */
export function useFileMoveMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileMoveMutationOptions(),
    onSuccess: ({ movedFiles, movedFolders }) => {
      invalidateResources([
        { resource: Resource.FILE_FOLDER, kind: 'update', id: ANY_ID },
        { resource: Resource.FILE, kind: 'update', id: ANY_ID },
      ]);
      const count = movedFiles + movedFolders;
      if (count > 0) toast.success(t('file.move.success', { count }));
    },
    onError: (error) => {
      invalidateResources([{ resource: Resource.FILE_FOLDER, kind: 'update', id: ANY_ID }]);
      showError(error);
    },
  });
}
