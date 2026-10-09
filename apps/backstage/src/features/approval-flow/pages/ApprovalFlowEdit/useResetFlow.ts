import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { useTranslation } from '@b2b-system/web-core/locales';
import { createElement } from 'react';

import type { ApprovalFlow } from '@/shared/api-sdk';

import { useApprovalFlowResetMutation } from '../../hooks/useApprovalFlowMutations';

/**
 * 重設流程（docs/architecture/backend/20-approval.md §9.16、§12 D10）：確認後刪掉已儲存的流程，這個類型回到單關審批，
 * 下次設定從範本開始。進行中的申請照送出時的關卡走完；舊的設定留在稽核日誌。回傳是否已重設。
 */
export function useResetFlow(item: ApprovalFlow | undefined) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const reset = useApprovalFlowResetMutation();

  const run = async (): Promise<boolean> => {
    const flow = item?.flow;
    if (!item || !flow) return false;
    const confirmed = await confirm({
      title: t('approvalFlow.reset.title'),
      description: createElement(
        'div',
        { className: 'flex flex-col gap-2' },
        createElement('p', { className: 'm-0' }, t('approvalFlow.reset.description')),
        item.inFlightCount > 0 &&
          createElement(
            'p',
            { className: 'm-0' },
            t('approvalFlow.reset.inFlight', { count: item.inFlightCount }),
          ),
      ),
      confirmLabel: t('approvalFlow.reset.action'),
      tone: 'danger',
      'data-testid': 'approval-flow-reset-confirm',
    });
    if (!confirmed) return false;
    try {
      await reset.mutateAsync({ params: { type: item.type, version: flow.version } });
      return true;
    } catch {
      // 錯誤由 mutation 的 toast 顯示
      return false;
    }
  };

  return { run, isPending: reset.isPending };
}
