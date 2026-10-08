import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getApproveApprovalMutationOptions } from '@/apis/approval/approve-approval/mutation';
import { getApprovalStepDecideMutationOptions } from '@/apis/approval/decide-approval-step/mutation';
import { getApprovalStepOverrideMutationOptions } from '@/apis/approval/override-approval-step/mutation';
import { getApprovalStepRefreshMutationOptions } from '@/apis/approval/refresh-approval-step/mutation';
import { getRejectApprovalMutationOptions } from '@/apis/approval/reject-approval/mutation';
import { getApprovalWithdrawMutationOptions } from '@/apis/approval/withdraw-approval/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import type { ResourceChangeEvent } from '@/apis/resources';
import type { ApprovalRequest } from '@/shared/api-sdk';

/** 審核通過後的來源變更：單筆 mutation（立刻失效）與批次操作（`batch.ts`，交給佇列合併）共用。 */
export function approvalReviewedChanges(
  approval: ApprovalRequest,
  roleIds: string[],
): ResourceChangeEvent[] {
  return [
    { resource: Resource.APPROVAL, kind: 'update', id: approval.id },
    // user.register 核准會建立帳號（帶上指派的角色，讓角色的 userCount 更新）
    ...(approval.type === 'user.register' && approval.resultResourceId
      ? [
          {
            resource: Resource.USER,
            kind: 'create' as const,
            id: approval.resultResourceId,
            refs: { role: roleIds },
          },
        ]
      : []),
  ];
}

/** 錯誤不在這裡吞掉：由審核對話框顯示在表單上（例：USER_EMAIL_DUPLICATE 要讓審核者改為駁回）。 */
export function useApproveApprovalMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getApproveApprovalMutationOptions(),
    onSuccess: (approval, { params }) => {
      invalidateResources(approvalReviewedChanges(approval, params.body.roleIds ?? []));
      toast.success(t('approval.approve.success'));
    },
  });
}

export function useRejectApprovalMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getRejectApprovalMutationOptions(),
    onSuccess: (approval) => {
      invalidateResources([{ resource: Resource.APPROVAL, kind: 'update', id: approval.id }]);
      toast.success(t('approval.reject.success'));
    },
  });
}

/**
 * 多階段：在目前的關卡同意或駁回（docs/architecture/backend/20-approval.md §9.7）。最後一關的核准會套用變更：
 * 與單關的核准一樣宣告 user create（註冊）。錯誤由對話框顯示（例：APPROVAL_STEP_STALE 要重新整理）。
 */
export function useDecideApprovalStepMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getApprovalStepDecideMutationOptions(),
    onSuccess: (approval, { params }) => {
      invalidateResources(approvalReviewedChanges(approval, []));
      toast.success(
        t(
          params.body.decision === 'approve'
            ? 'approval.approve.success'
            : 'approval.reject.success',
        ),
      );
    },
  });
}

/** 多階段：強制定案目前的關卡（`approval:override`，§9.8）。 */
export function useOverrideApprovalStepMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getApprovalStepOverrideMutationOptions(),
    onSuccess: (approval) => {
      invalidateResources(approvalReviewedChanges(approval, []));
      toast.success(t('approval.override.success'));
    },
  });
}

/** 多階段：依規則重新展開目前關卡的審核者（§9.8）。 */
export function useRefreshApprovalStepMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getApprovalStepRefreshMutationOptions(),
    onSuccess: (approval) => {
      invalidateResources([{ resource: Resource.APPROVAL, kind: 'update', id: approval.id }]);
      toast.success(t('approval.refresh.success'));
    },
  });
}

/** 申請人撤回自己仍待審的申請（§9.9）。 */
export function useWithdrawApprovalMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getApprovalWithdrawMutationOptions(),
    onSuccess: (approval) => {
      invalidateResources([{ resource: Resource.APPROVAL, kind: 'update', id: approval.id }]);
      toast.success(t('approval.withdraw.success'));
    },
  });
}
