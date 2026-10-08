import { describe, expect, it } from 'vitest';

import type { Webhook } from '@/shared/api-sdk';

import { toWebhookRowVM } from '../adapter';

const webhook = (overrides: Partial<Webhook> = {}): Webhook =>
  ({
    id: 'w1',
    name: 'CI',
    targets: [{ url: 'https://hooks.example.test/a' }],
    status: 'active',
    disabledReason: null,
    events: ['user.created', 'user.deleted'],
    consecutiveFailures: 0,
    lastDeliveryAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }) as unknown as Webhook;

describe('toWebhookRowVM（Webhook 列表的一列）', () => {
  it('只有一個網址：顯示它、沒有「另外 N 個」；事件數與最後投遞時間', () => {
    expect(toWebhookRowVM(webhook())).toMatchObject({
      url: 'https://hooks.example.test/a',
      moreUrls: 0,
      eventCount: 2,
      lastDeliveryAt: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('多個網址：顯示第一個，其餘算成數量', () => {
    const vm = toWebhookRowVM(
      webhook({
        targets: [{ url: 'https://a.test' }, { url: 'https://b.test' }, { url: 'https://c.test' }],
      } as never),
    );
    expect(vm).toMatchObject({ url: 'https://a.test', moreUrls: 2 });
  });

  it('沒有網址、還沒投遞過 → 空字串與 null', () => {
    expect(toWebhookRowVM(webhook({ targets: [], lastDeliveryAt: null } as never))).toMatchObject({
      url: '',
      moreUrls: 0,
      lastDeliveryAt: null,
    });
  });
});
