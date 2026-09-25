import { useState } from 'react';

import { useErrorMessage } from '@/core/errors';

import {
  useApproveApprovalMutation,
  useRejectApprovalMutation,
} from '../../hooks/useApprovalMutations';

/** 審核表單的狀態：核准時指派的角色、審核意見、送出錯誤。 */
export function useApprovalReview(approvalId: string, onReviewed: () => void) {
  const approve = useApproveApprovalMutation();
  const reject = useRejectApprovalMutation();
  const toMessage = useErrorMessage();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();

  const submit = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
      onReviewed();
    } catch (caught) {
      // 例：申請後 email 被直接建立 → USER_EMAIL_DUPLICATE，審核者可改為駁回
      setError(toMessage(caught));
    }
  };

  const trimmed = comment.trim() || undefined;

  return {
    roleIds,
    setRoleIds,
    comment,
    setComment,
    error,
    isPending: approve.isPending || reject.isPending,
    isApproving: approve.isPending,
    isRejecting: reject.isPending,
    approve: () =>
      submit(() =>
        approve.mutateAsync({ params: { approvalId, body: { comment: trimmed, roleIds } } }),
      ),
    reject: () =>
      submit(() => reject.mutateAsync({ params: { approvalId, body: { comment: trimmed } } })),
  };
}

export type ApprovalReviewState = ReturnType<typeof useApprovalReview>;
