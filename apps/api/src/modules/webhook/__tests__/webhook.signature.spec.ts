import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { WEBHOOK_USER_AGENT } from '../webhook.constants';
import { signWebhook, webhookHeaders } from '../webhook.signature';
import type { WebhookEnvelope } from '../webhook.signature';

const SECRET = 'whsec_test';
const TS = 1_700_000_000;
const BODY = '{"id":"ev-1"}';

/** 接收端的驗證方式（docs/architecture/backend/17-webhook.md §9.2 D11）：以同一把密鑰重算後比對。 */
function verify(secret: string, timestamp: number, body: string, signature: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
  return expected === signature;
}

describe('signWebhook（docs/architecture/backend/17-webhook.md §9.2 D11）', () => {
  const signature = signWebhook(SECRET, TS, BODY);

  it('格式是 sha256= 加 64 個小寫 hex', () => {
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('同樣的輸入簽出同樣的值', () => {
    expect(signWebhook(SECRET, TS, BODY)).toBe(signature);
  });

  it.each([
    ['密鑰相同、時間戳與 body 都對', SECRET, TS, BODY, true],
    ['密鑰不同', 'whsec_other', TS, BODY, false],
    ['時間戳被改（重放時換新時間）', SECRET, TS + 1, BODY, false],
    ['body 被改', SECRET, TS, '{"id":"ev-2"}', false],
    ['body 多一個空白', SECRET, TS, `${BODY} `, false],
    ['時間戳與 body 的分隔被搬動', SECRET, 170_000_000, `0.${BODY}`, false],
  ])('接收端驗證：%s → %s', (_label, secret, timestamp, body, expected) => {
    expect(verify(secret, timestamp, body, signature)).toBe(expected);
  });

  it('body 含多位元組字元時以 UTF-8 簽', () => {
    const body = '{"name":"美術"}';
    expect(verify(SECRET, TS, body, signWebhook(SECRET, TS, body))).toBe(true);
  });
});

describe('webhookHeaders（docs/architecture/backend/17-webhook.md §9.2 D3、D11）', () => {
  const envelope: WebhookEnvelope = {
    id: 'ev-1',
    type: 'user.created',
    version: 1,
    occurredAt: '2026-10-01T00:00:00.000Z',
    tenant: 'acme',
    data: { userId: 'u1' },
  };

  it('帶事件 id、事件名稱、時間戳與簽章，簽的是同一個 body', () => {
    expect(webhookHeaders(envelope, SECRET, TS, BODY)).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': WEBHOOK_USER_AGENT,
      'X-Webhook-Id': 'ev-1',
      'X-Webhook-Event': 'user.created',
      'X-Webhook-Timestamp': String(TS),
      'X-Webhook-Signature': signWebhook(SECRET, TS, BODY),
    });
  });
});
