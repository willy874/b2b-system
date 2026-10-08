import { describe, expect, it } from 'vitest';

import type { WebhookDelivery } from '@/shared/api-sdk';

import { toWebhookDeliveryRowVM } from '../adapter';

const delivery = (overrides: Partial<WebhookDelivery> = {}): WebhookDelivery => ({
  id: 'd1',
  eventId: 'e1',
  eventType: 'user.created',
  eventData: {},
  url: 'https://hooks.example.test/a',
  attempt: 1,
  occurredAt: '2026-10-01T00:00:00.000Z',
  targetId: null,
  trigger: 'auto',
  succeeded: true,
  responseStatus: 200,
  error: null,
  durationMs: 120,
  responseBody: 'ok',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

describe('toWebhookDeliveryRowVM（投遞紀錄的一列）', () => {
  it('有回應時結果是狀態碼，時間轉成 Date', () => {
    const vm = toWebhookDeliveryRowVM(delivery());
    expect(vm).toMatchObject({ id: 'd1', result: '200', succeeded: true, durationMs: 120 });
    expect(vm.createdAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });

  it('沒有回應（連線失敗）→ 結果是錯誤原因', () => {
    expect(
      toWebhookDeliveryRowVM(delivery({ responseStatus: null, error: 'ECONNREFUSED' })).result,
    ).toBe('ECONNREFUSED');
  });

  it('沒有回應也沒有錯誤 → 「-」', () => {
    expect(toWebhookDeliveryRowVM(delivery({ responseStatus: null, error: null })).result).toBe(
      '-',
    );
  });
});
