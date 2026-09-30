import { useMutation } from '@tanstack/react-query';

import { getFileFolderCreateMutationOptions } from '@/apis/file/create-file-folder/mutation';
import { getFileFolderDeleteMutationOptions } from '@/apis/file/delete-file-folder/mutation';
import { getFileMoveMutationOptions } from '@/apis/file/move-file-items/mutation';
import { getFileFolderUpdateMutationOptions } from '@/apis/file/update-file-folder/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { ANY_ID } from '@/core/cache';
import { isAppError, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

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

/** 遞迴刪除資料夾：子資料夾與其中的檔案一起消失，所以檔案的列表與詳情也要失效。 */
export function useFolderDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getFileFolderDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateDeletedFolder(params.folderId);
      toast.success(t('file.folder.delete.success'));
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
