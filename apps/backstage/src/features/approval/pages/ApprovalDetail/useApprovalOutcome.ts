import { useTranslation } from '@b2b-system/web-core/locales';

import { APPROVAL_OUTCOME_KEY, FILE_ACCESS_LEVEL_LABEL_KEY } from '../../constants';
import { outcomeParams } from './adapter';
import type { ApprovalDetailVM } from './adapter';

/**
 * 核准的結果句（docs/architecture/backend/20-approval.md §11.3、§12 D7）：已核准時是「已經怎樣」，其他時候是「核准後會怎樣」。
 * 句子在前端語系、依類型對照（`APPROVAL_OUTCOME_KEY`），後端不回傳顯示文字。
 */
export function useApprovalOutcome(approval: ApprovalDetailVM): string {
  const { t } = useTranslation();
  const keys = APPROVAL_OUTCOME_KEY[approval.type];
  const { level, ...params } = outcomeParams(approval);
  return t(approval.status === 'approved' ? keys.done : keys.pending, {
    ...params,
    level: level ? t(FILE_ACCESS_LEVEL_LABEL_KEY[level]) : undefined,
  });
}
