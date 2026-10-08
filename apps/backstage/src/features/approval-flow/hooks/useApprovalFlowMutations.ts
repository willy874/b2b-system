import { isVersionConflict } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getApprovalFlowPreviewMutationOptions } from '@/apis/approval-flow/preview-approval-flow/mutation';
import { getApprovalFlowPutMutationOptions } from '@/apis/approval-flow/put-approval-flow/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/**
 * 儲存流程（建立或取代）。衝突時失效該類型讓畫面拿到最新版本，訊息交給頁面（`VersionConflictAlert`）；
 * 其他錯誤（欄位不合法、規則不可用）也由頁面標到關卡上，不彈 toast。
 */
export function useApprovalFlowSaveMutation() {
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getApprovalFlowPutMutationOptions(),
    onSuccess: (saved, { params }) => {
      invalidateResources([
        {
          resource: Resource.APPROVAL_FLOW,
          kind: params.body.version ? 'update' : 'create',
          id: saved.type,
        },
      ]);
      toast.success(t('approvalFlow.save.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([
          { resource: Resource.APPROVAL_FLOW, kind: 'update', id: params.type },
        ]);
      }
    },
  });
}

/** 試算（唯讀）：結果與錯誤都顯示在試算面板。 */
export function useApprovalFlowPreviewMutation() {
  return useMutation(getApprovalFlowPreviewMutationOptions());
}
