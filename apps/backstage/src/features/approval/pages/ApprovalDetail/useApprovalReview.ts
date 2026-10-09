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

/** 完成的是哪一種操作：定案或關卡的決定（`decided`），或申請人撤回（`withdrawn`）。 */
export type ApprovalReviewOutcome = 'decided' | 'withdrawn';

/**
 * 審核表單的狀態：核准時指派的角色、審核意見、送出錯誤。成功後清空表單（留在原頁時不再算「未儲存」），
 * 再呼叫 `onReviewed`：從待審清單進來的詳情據此前往下一筆（docs/architecture/backend/20-approval.md §12 D5）。
 * 單關的核准／駁回之外，多階段的關卡決定、強制定案、重新展開與撤回也在這裡（§9）。
 */
export function useApprovalReview(
  approvalId: string,
  onReviewed: (outcome: ApprovalReviewOutcome) => void,
) {
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

  const submit = async (
    action: () => Promise<unknown>,
    outcome: ApprovalReviewOutcome = 'decided',
  ) => {
    setError(undefined);
    try {
      await action();
      setComment('');
      setRoleIds([]);
      onReviewed(outcome);
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
    /** 重新展開審核者：留在原處看新的名單，不算定案。 */
    refresh: async (ordinal: number) => {
      setError(undefined);
      try {
        await refresh.mutateAsync({ params: { approvalId, ordinal } });
      } catch (caught) {
        setError(toMessage(caught));
      }
    },
    withdraw: () => submit(() => withdraw.mutateAsync({ params: { approvalId } }), 'withdrawn'),
  };
}

export type ApprovalReviewState = ReturnType<typeof useApprovalReview>;
