import { isVersionConflict, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getCommentCreateMutationOptions } from '@/apis/comment/create-comment/mutation';
import { getCommentDeleteMutationOptions } from '@/apis/comment/delete-comment/mutation';
import { getCommentUpdateMutationOptions } from '@/apis/comment/update-comment/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/** 留言：錯誤（例：提及的人看不到這個資源）由編輯器顯示，不彈 toast。作者自動關注，關注狀態跟著重抓（依賴圖）。 */
export function useCommentCreateMutation() {
  return useMutation({
    ...getCommentCreateMutationOptions(),
    onSuccess: (comment) => {
      invalidateResources([{ resource: Resource.COMMENT, kind: 'create', id: comment.id }]);
    },
  });
}

/** 編輯（帶 `version`）：衝突時讓列表拿到最新版本，訊息交給編輯器。 */
export function useCommentUpdateMutation() {
  return useMutation({
    ...getCommentUpdateMutationOptions(),
    onSuccess: (comment) => {
      invalidateResources([{ resource: Resource.COMMENT, kind: 'update', id: comment.id }]);
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.COMMENT, kind: 'update', id: params.commentId }]);
      }
    },
  });
}

/** 硬刪除、不進回收桶（docs/architecture/backend/24-comment.md §8.2 D5）：成功的提示沒有「復原」。 */
export function useCommentDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getCommentDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.COMMENT, kind: 'delete', id: params.commentId }]);
      toast.success(t('comment.delete.success'));
    },
    onError: showError,
  });
}
