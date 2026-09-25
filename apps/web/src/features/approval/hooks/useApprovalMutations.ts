import { useMutation } from '@tanstack/react-query';

import { getApproveApprovalMutationOptions } from '@/apis/approval/approve-approval/mutation';
import { getBatchApproveApprovalMutationOptions } from '@/apis/approval/batch-approve-approval/mutation';
import { getBatchRejectApprovalMutationOptions } from '@/apis/approval/batch-reject-approval/mutation';
import { getRejectApprovalMutationOptions } from '@/apis/approval/reject-approval/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';
import type { BatchResult } from '@/shared/api-sdk';

/** 錯誤不在這裡吞掉：由審核對話框顯示在表單上（例：USER_EMAIL_DUPLICATE 要讓審核者改為駁回）。 */
export function useApproveApprovalMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getApproveApprovalMutationOptions(),
    onSuccess: (approval, { params }) => {
      invalidateResources([
        { resource: Resource.APPROVAL, kind: 'update', id: approval.id },
        // user.register 核准會建立帳號（帶上指派的角色，讓角色的 userCount 更新）
        ...(approval.type === 'user.register' && approval.resultResourceId
          ? [
              {
                resource: Resource.USER,
                kind: 'create' as const,
                id: approval.resultResourceId,
                refs: { role: params.body.roleIds ?? [] },
              },
            ]
          : []),
      ]);
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

// ── 批次（ADR-0009）：提示與結果對話框由 RichTable 的批次流程處理，這裡只負責失效快取 ──

/**
 * 成功時只失效實際審核的那幾筆；整批失敗（網路、500）時已提交的筆數不明，送出的全部失效。
 * 批次核准會建立帳號，但回應不帶新帳號的 id → 使用者端整批失效（快速核准不指派角色，不影響角色）。
 */
function invalidateBatch(createsUsers: boolean) {
  return (
    result: BatchResult | undefined,
    _error: unknown,
    { params }: { params: { body: { ids: string[] } } },
  ) => {
    const ids = result?.succeeded ?? params.body.ids;
    invalidateResources([
      ...ids.map((id) => ({ resource: Resource.APPROVAL, kind: 'update' as const, id })),
      ...(createsUsers && ids.length
        ? [{ resource: Resource.USER, kind: 'create' as const, refs: { role: [] } }]
        : []),
    ]);
  };
}

export function useBatchApproveApprovalMutation() {
  return useMutation({
    ...getBatchApproveApprovalMutationOptions(),
    onSettled: invalidateBatch(true),
  });
}

export function useBatchRejectApprovalMutation() {
  return useMutation({
    ...getBatchRejectApprovalMutationOptions(),
    onSettled: invalidateBatch(false),
  });
}
