import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { useTranslation } from '@b2b-system/web-core/locales';
import { createElement } from 'react';

import type { ApprovalFlow } from '@/shared/api-sdk';

import type { FlowDraft } from '../../hooks/flowDraft';
import { saveImpacts } from './saveImpacts';

/**
 * 儲存前說明影響（docs/architecture/backend/20-approval.md §9.16）：進行中的申請照舊版本、啟用或停用改變新申請怎麼審。
 * 沒有影響時直接儲存；取消確認時不送出。
 */
export function useSaveWithImpacts(
  item: ApprovalFlow | undefined,
  draft: FlowDraft | undefined,
  submit: () => Promise<boolean>,
  /** 只驗證、不送出；有錯時直接回傳 false，不先開影響的確認。 */
  validate: () => boolean,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  /** 回傳是否已儲存；取消確認或驗證不過時為 false。 */
  return async (): Promise<boolean> => {
    if (!item || !draft) return false;
    if (!validate()) return false;
    const impacts = saveImpacts(item, draft, t);
    if (impacts.length) {
      const confirmed = await confirm({
        title: t('approvalFlow.save.confirmTitle'),
        description: createElement(
          'ul',
          { className: 'm-0 flex flex-col gap-1 ps-5' },
          impacts.map((impact) => createElement('li', { key: impact }, impact)),
        ),
        confirmLabel: t('common.save'),
        // 只是說明影響，不是破壞性的操作
        tone: 'primary',
        'data-testid': 'approval-flow-save-confirm',
      });
      if (!confirmed) return false;
    }
    return submit();
  };
}
