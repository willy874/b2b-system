import { isVersionConflict, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getGalleryAlbumAddItemsMutationOptions } from '@/apis/gallery/add-gallery-album-items/mutation';
import { getGalleryClearFailedMutationOptions } from '@/apis/gallery/clear-gallery-failed/mutation';
import { getGalleryAlbumCreateMutationOptions } from '@/apis/gallery/create-gallery-album/mutation';
import { getGalleryFromSourceMutationOptions } from '@/apis/gallery/create-gallery-from-source/mutation';
import { getGalleryAlbumDeleteMutationOptions } from '@/apis/gallery/delete-gallery-album/mutation';
import { getGalleryItemDeleteMutationOptions } from '@/apis/gallery/delete-gallery-item/mutation';
import { getGalleryAlbumRemoveItemsMutationOptions } from '@/apis/gallery/remove-gallery-album-items/mutation';
import { getGalleryAlbumRestoreMutationOptions } from '@/apis/gallery/restore-gallery-album/mutation';
import { getGalleryItemRestoreMutationOptions } from '@/apis/gallery/restore-gallery-item/mutation';
import { getGalleryAlbumUpdateMutationOptions } from '@/apis/gallery/update-gallery-album/mutation';
import { getGalleryItemUpdateMutationOptions } from '@/apis/gallery/update-gallery-item/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { getResourceTagsReplaceMutationOptions } from '@/apis/tag/replace-resource-tags/mutation';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

/**
 * 標題、說明、顯示方向（樂觀鎖）。衝突時失效那一張讓畫面拿到最新版本，訊息交給表單顯示；
 * 其他錯誤以 toast 顯示。
 */
export function useGalleryItemUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getGalleryItemUpdateMutationOptions(),
    onSuccess: (item, { params }) => {
      invalidateResources([{ resource: Resource.GALLERY_ITEM, kind: 'update', id: item.id }]);
      toast.success(
        params.body.displayRotation === undefined
          ? t('gallery.update.success')
          : t('gallery.rotate.success'),
      );
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([
          { resource: Resource.GALLERY_ITEM, kind: 'update', id: params.itemId },
        ]);
      }
      showError(error);
    },
  });
}

export function useGalleryItemDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  // 回收桶被平台關掉時不說「已移到回收桶」（那時沒有地方可以還原）
  const hasTrash = useIsFeatureReady(TenantFeature.trash);
  return useMutation({
    ...getGalleryItemDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.GALLERY_ITEM, kind: 'delete', id: params.itemId }]);
      toast.success(hasTrash ? t('gallery.delete.success') : t('gallery.delete.successNoTrash'));
    },
    onError: showError,
  });
}

export function useGalleryItemRestoreMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getGalleryItemRestoreMutationOptions(),
    onSuccess: (item) => {
      invalidateResources([{ resource: Resource.GALLERY_ITEM, kind: 'create', id: item.id }]);
      toast.success(t('gallery.restore.success', { name: item.title }));
    },
    onError: showError,
  });
}

/** 整批取代一張圖的標籤；錯誤由對話框顯示。 */
export function useGalleryItemTagsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getResourceTagsReplaceMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.GALLERY_ITEM, kind: 'update', id: params.resourceId },
      ]);
      toast.success(t('tag.assign.success'));
    },
  });
}

export function useGalleryClearFailedMutation() {
  const showError = useErrorToast();
  return useMutation({
    ...getGalleryClearFailedMutationOptions(),
    onSuccess: () => invalidateResources([{ resource: Resource.GALLERY_ITEM, kind: 'delete' }]),
    onError: showError,
  });
}

/** 從其他來源加入：結果（加入幾張、略過幾張與原因）由呼叫端的對話框顯示。 */
export function useGalleryFromSourceMutation() {
  return useMutation({
    ...getGalleryFromSourceMutationOptions(),
    // 處理完成時伺服器推 create；這裡只讓自己的「處理中」計數立刻更新
    onSuccess: () => invalidateResources([{ resource: Resource.GALLERY_ITEM, kind: 'update' }]),
  });
}

// ── 相簿 ──

export function useGalleryAlbumCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getGalleryAlbumCreateMutationOptions(),
    onSuccess: (album) => {
      invalidateResources([{ resource: Resource.GALLERY_ALBUM, kind: 'create', id: album.id }]);
      toast.success(t('gallery.album.create.success', { name: album.name }));
    },
    // 錯誤（名稱重複）交給表單顯示
  });
}

export function useGalleryAlbumUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getGalleryAlbumUpdateMutationOptions(),
    onSuccess: (album) => {
      invalidateResources([{ resource: Resource.GALLERY_ALBUM, kind: 'update', id: album.id }]);
      toast.success(t('gallery.album.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([
          { resource: Resource.GALLERY_ALBUM, kind: 'update', id: params.albumId },
        ]);
      }
    },
  });
}

export function useGalleryAlbumDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const hasTrash = useIsFeatureReady(TenantFeature.trash);
  return useMutation({
    ...getGalleryAlbumDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.GALLERY_ALBUM, kind: 'delete', id: params.albumId },
      ]);
      toast.success(
        hasTrash ? t('gallery.album.delete.success') : t('gallery.album.delete.successNoTrash'),
      );
    },
    onError: showError,
  });
}

export function useGalleryAlbumRestoreMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getGalleryAlbumRestoreMutationOptions(),
    onSuccess: (album) => {
      invalidateResources([{ resource: Resource.GALLERY_ALBUM, kind: 'create', id: album.id }]);
      toast.success(t('gallery.restore.success', { name: album.name }));
    },
    onError: showError,
  });
}

/** 加入相簿（一次一個請求，最多 500 張）：已經在的略過。 */
export function useGalleryAlbumAddItemsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getGalleryAlbumAddItemsMutationOptions(),
    onSuccess: (result, { params }) => {
      invalidateResources([
        { resource: Resource.GALLERY_ALBUM, kind: 'update', id: params.albumId },
        { resource: Resource.GALLERY_ITEM, kind: 'update' },
      ]);
      toast.success(t('gallery.album.add.success', { count: result.changed }));
    },
    onError: showError,
  });
}

export function useGalleryAlbumRemoveItemsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getGalleryAlbumRemoveItemsMutationOptions(),
    onSuccess: (result, { params }) => {
      invalidateResources([
        { resource: Resource.GALLERY_ALBUM, kind: 'update', id: params.albumId },
        { resource: Resource.GALLERY_ITEM, kind: 'update' },
      ]);
      toast.success(t('gallery.album.remove.success', { count: result.changed }));
    },
    onError: showError,
  });
}
