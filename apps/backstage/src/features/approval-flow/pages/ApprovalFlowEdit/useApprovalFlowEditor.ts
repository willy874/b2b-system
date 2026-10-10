import {
  AppError,
  isVersionConflict,
  useErrorMessage,
  useErrorToast,
} from '@b2b-system/web-core/errors';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getApprovalFlowDetailQueryOptions } from '@/apis/approval-flow/get-approval-flow-detail/query';
import type { ApprovalFlow } from '@/shared/api-sdk';

import { toPutRequest, validateFlowDraft } from '../../hooks/flowDraft';
import type { FlowDraft } from '../../hooks/flowDraft';
import { useApprovalFlowDraft } from '../../hooks/useApprovalFlowDraft';
import { useApprovalFlowSaveMutation } from '../../hooks/useApprovalFlowMutations';

const EMPTY: Readonly<Record<string, string>> = {};

/** `422 APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE` 的 `details.steps`：規則不能用的關卡索引。 */
function rejectedSteps(error: unknown): ReadonlySet<number> {
  if (!(error instanceof AppError) || error.code !== 'APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE') {
    return new Set();
  }
  const steps = error.details?.steps;
  return new Set(
    Array.isArray(steps) ? steps.filter((step): step is number => typeof step === 'number') : [],
  );
}

/**
 * 流程編輯頁的狀態：草稿、儲存、錯誤對到關卡與欄位、版本衝突後重新載入（docs/architecture/backend/20-approval.md §9.13、§9.16）。
 *
 * - 前端驗證在第一次按儲存之後才顯示（還沒填完就一片紅不友善），之後隨輸入即時更新。
 * - 後端 `VALIDATION_FAILED` 的 `details.fields` 與前端驗證用同一種路徑，一起標到欄位上。
 */
export function useApprovalFlowEditor(type: string, item: ApprovalFlow | undefined) {
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  const toMessage = useErrorMessage();
  const save = useApprovalFlowSaveMutation();
  const { draft, update, isDirty, discard } = useApprovalFlowDraft(item);
  const [attempted, setAttempted] = useState(false);
  const [reloading, setReloading] = useState(false);
  useUnsavedChangesGuard(isDirty);

  const fields = item?.fields ?? [];
  const clientErrors = useMemo(
    () => (attempted && draft ? validateFlowDraft(draft, item?.fields ?? []) : EMPTY),
    [attempted, draft, item],
  );
  const serverErrors = (save.error instanceof AppError && save.error.fieldErrors) || EMPTY;

  /** 只驗證草稿並標出錯誤；儲存前先跑，有錯就不必先確認影響（確認之後才看到錯誤，等於白確認一次）。 */
  const validate = (): boolean => {
    if (!draft) return false;
    setAttempted(true);
    return toPutRequest(draft, fields) !== null;
  };

  /** 送出；回傳是否已儲存（頁面據此回到審批流程的分頁）。 */
  const submit = async (): Promise<boolean> => {
    if (!draft) return false;
    setAttempted(true);
    const body = toPutRequest(draft, fields);
    if (!body) return false;
    try {
      await save.mutateAsync({ params: { type, body } });
    } catch {
      // 錯誤標在關卡與欄位上；草稿保留，讓使用者修正後重送
      return false;
    }
    setAttempted(false);
    discard();
    return true;
  };

  /** 衝突後放棄這次的修改：重抓最新的流程與版本，草稿改成以它為基礎。 */
  const reload = async () => {
    setReloading(true);
    try {
      await queryClient.fetchQuery({ ...getApprovalFlowDetailQueryOptions(type), staleTime: 0 });
      save.reset();
      setAttempted(false);
      discard();
    } catch (error) {
      showError(error);
    } finally {
      setReloading(false);
    }
  };

  return {
    draft,
    update: (change: (draft: FlowDraft) => FlowDraft) => update(change),
    isDirty,
    /** 放棄修改，回到伺服器上的流程。 */
    discard: () => {
      save.reset();
      setAttempted(false);
      discard();
    },
    submit,
    validate,
    isSaving: save.isPending,
    errors: { ...serverErrors, ...clientErrors },
    rejectedSteps: rejectedSteps(save.error),
    conflictError: isVersionConflict(save.error) ? save.error : undefined,
    formError: save.error && !isVersionConflict(save.error) ? toMessage(save.error) : undefined,
    reload,
    reloading,
  };
}
