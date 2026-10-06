import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getApproveApprovalMutationOptions } from '@/apis/approval/approve-approval/mutation';
import { getRejectApprovalMutationOptions } from '@/apis/approval/reject-approval/mutation';
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
