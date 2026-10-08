import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useState } from 'react';

import {
  useApproveApprovalMutation,
  useDecideApprovalStepMutation,
  useOverrideApprovalStepMutation,
  useRefreshApprovalStepMutation,
  useRejectApprovalMutation,
  useWithdrawApprovalMutation,
} from '../../hooks/useApprovalMutations';

/**
 * 審核表單的狀態：核准時指派的角色、審核意見、送出錯誤。審核成功後呼叫 `onReviewed`（關閉要略過未儲存提醒）。
 * 單關的核准／駁回之外，多階段的關卡決定、強制定案、重新展開與撤回也在這裡（docs/architecture/backend/20-approval.md §9）。
 */
export function useApprovalReview(approvalId: string, onReviewed: () => void) {
  const approve = useApproveApprovalMutation();
  const reject = useRejectApprovalMutation();
  const decide = useDecideApprovalStepMutation();
  const override = useOverrideApprovalStepMutation();
  const refresh = useRefreshApprovalStepMutation();
  const withdraw = useWithdrawApprovalMutation();
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
    /** 輸入了審核意見或選了角色：關閉前要確認。 */
    isDirty: trimmed !== undefined || roleIds.length > 0,
    roleIds,
    setRoleIds,
    comment,
    setComment,
    error,
    isPending:
      approve.isPending ||
      reject.isPending ||
      decide.isPending ||
      override.isPending ||
      refresh.isPending ||
      withdraw.isPending,
    isApproving:
      approve.isPending ||
      (decide.isPending && decide.variables?.params.body.decision === 'approve'),
    isRejecting:
      reject.isPending || (decide.isPending && decide.variables?.params.body.decision === 'reject'),
    isOverriding: override.isPending,
    isRefreshing: refresh.isPending,
    isWithdrawing: withdraw.isPending,
    approve: () =>
      submit(() =>
        approve.mutateAsync({ params: { approvalId, body: { comment: trimmed, roleIds } } }),
      ),
    reject: () =>
      submit(() => reject.mutateAsync({ params: { approvalId, body: { comment: trimmed } } })),
    /** 多階段：在 `ordinal` 這一關同意或駁回。 */
    decide: (ordinal: number, decision: 'approve' | 'reject') =>
      submit(() =>
        decide.mutateAsync({
          params: { approvalId, ordinal, body: { decision, comment: trimmed, roleIds: [] } },
        }),
      ),
    /** 強制定案：意見必填（後端 400），按鈕在沒有意見時停用。 */
    override: (ordinal: number, decision: 'approve' | 'reject') =>
      submit(() =>
        override.mutateAsync({
          params: { approvalId, ordinal, body: { decision, comment: trimmed ?? '', roleIds: [] } },
        }),
      ),
    /** 重新展開審核者：不關閉對話框，留在原處看新的名單。 */
    refresh: async (ordinal: number) => {
      setError(undefined);
      try {
        await refresh.mutateAsync({ params: { approvalId, ordinal } });
      } catch (caught) {
        setError(toMessage(caught));
      }
    },
    withdraw: () => submit(() => withdraw.mutateAsync({ params: { approvalId } })),
  };
}

export type ApprovalReviewState = ReturnType<typeof useApprovalReview>;
