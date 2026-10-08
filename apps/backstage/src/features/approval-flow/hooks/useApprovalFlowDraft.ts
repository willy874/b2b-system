import { useCallback, useMemo, useState } from 'react';

import type { ApprovalFlow } from '@/shared/api-sdk';

import { draftSnapshot, flowToDraft } from './flowDraft';
import type { FlowDraft } from './flowDraft';

/**
 * 流程編輯的草稿。沒有改動時草稿就是伺服器上的流程（推播讓資料重抓時跟著更新）；第一次改動時複製一份，
 * 之後的修改都作用在副本上，版本（`version`）停在開始編輯的那一版——別人在這段時間存過，儲存時就會 409。
 */
export function useApprovalFlowDraft(item: ApprovalFlow | undefined) {
  const baseline = useMemo(() => (item ? flowToDraft(item) : undefined), [item]);
  const [edited, setEdited] = useState<FlowDraft | null>(null);

  const update = useCallback(
    (change: (draft: FlowDraft) => FlowDraft) =>
      setEdited((previous) => {
        const source = previous ?? baseline;
        return source ? change(source) : previous;
      }),
    [baseline],
  );

  return {
    draft: edited ?? baseline,
    update,
    isDirty:
      edited !== null &&
      baseline !== undefined &&
      draftSnapshot(edited) !== draftSnapshot(baseline),
    /** 丟掉草稿、改用伺服器上的流程（儲存成功、或衝突後重新載入時呼叫）。 */
    discard: useCallback(() => setEdited(null), []),
  };
}
