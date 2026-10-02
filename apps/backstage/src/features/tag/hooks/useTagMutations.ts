import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getTagCreateMutationOptions } from '@/apis/tag/create-tag/mutation';
import { getTagDeleteMutationOptions } from '@/apis/tag/delete-tag/mutation';
import { getTagUpdateMutationOptions } from '@/apis/tag/update-tag/mutation';
import { isVersionConflict, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

/** 建立：錯誤由表單顯示（例：同名），不彈 toast。 */
export function useTagCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getTagCreateMutationOptions(),
    onSuccess: (tag) => {
      invalidateResources([{ resource: Resource.TAG, kind: 'create', id: tag.id }]);
      toast.success(t('tagAdmin.create.success', { name: tag.name }));
    },
  });
}

/** 改名、改色：帶 `version`；衝突時讓列表拿到最新版本，訊息交給表單。 */
export function useTagUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getTagUpdateMutationOptions(),
    onSuccess: (tag) => {
      invalidateResources([{ resource: Resource.TAG, kind: 'update', id: tag.id }]);
      toast.success(t('tagAdmin.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.TAG, kind: 'update', id: params.tagId }]);
      }
    },
  });
}

/** 硬刪除、不進回收桶：成功的提示沒有「復原」。 */
export function useTagDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getTagDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.TAG, kind: 'delete', id: params.tagId }]);
      toast.success(t('tagAdmin.delete.success'));
    },
    onError: showError,
  });
}
