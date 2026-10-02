import { defineWebhookEvent } from '@/modules/webhook/webhook.definition';
import type { AnyWebhookEventType } from '@/modules/webhook/webhook.definition';

import type { ApprovalType } from './approval.constants';

/**
 * 審批被核准或駁回（docs/adr/0030-webhooks.md D2、D3）：只帶 id、類型與結果；申請內容與審核意見由接收端回查。
 */
export const APPROVAL_DECIDED_WEBHOOK = defineWebhookEvent<{
  approvalId: string;
  approvalType: ApprovalType;
  decision: 'approved' | 'rejected';
}>('approval.decided', { version: 1 });

export const APPROVAL_WEBHOOK_EVENTS: readonly AnyWebhookEventType[] = [APPROVAL_DECIDED_WEBHOOK];
