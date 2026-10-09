import { describe, expect, it } from 'vitest';

import type { ApprovalFlow } from '@/shared/api-sdk';

import { flowToDraft } from '../../../hooks/flowDraft';
import { saveImpacts } from '../saveImpacts';

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;

const ITEM: ApprovalFlow = {
  type: 'test.purchase',
  requester: 'user',
  fields: [],
  requiredPermissions: [],
  inFlightCount: 0,
  flow: {
    id: 'f1',
    enabled: true,
    allowRepeatApprover: false,
    version: 1,
    updatedAt: '2026-10-01T00:00:00.000Z',
    steps: [],
  },
};

describe('儲存前的影響（docs/architecture/backend/20-approval.md §9.16）', () => {
  it('沒有進行中的申請、沒改開關：不必確認', () => {
    expect(saveImpacts(ITEM, flowToDraft(ITEM), t)).toEqual([]);
  });

  it('有進行中的申請：說明它們照舊版本', () => {
    expect(saveImpacts({ ...ITEM, inFlightCount: 3 }, flowToDraft(ITEM), t)).toEqual([
      'approvalFlow.save.impact.inFlight:{"count":3}',
    ]);
  });

  it('停用：新的申請改回單關', () => {
    expect(saveImpacts(ITEM, { ...flowToDraft(ITEM), enabled: false }, t)).toEqual([
      'approvalFlow.save.impact.disable',
    ]);
  });

  it('第一次設定（啟用）：新的申請依流程審核', () => {
    const unset = { ...ITEM, flow: null };
    expect(saveImpacts(unset, flowToDraft(unset), t)).toEqual(['approvalFlow.save.impact.enable']);
  });
});
