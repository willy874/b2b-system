import { describe, expect, it } from 'vitest';

import type { NotificationOverviewItem } from '@/shared/api-sdk';

import { toNotificationOverviewRowVM } from '../adapter';

const base: NotificationOverviewItem = {
  id: 'n1',
  type: 'webhook.disabled',
  params: { webhookName: 'CI', consecutiveFailures: 5 },
  link: { route: 'webhook.detail', params: { webhookId: 'w1' } },
  actor: null,
  readAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  recipient: { id: 'u1', name: 'Alice' },
};

describe('toNotificationOverviewRowVM（通知總覽的一列）', () => {
  it('認得的事件：名稱 key 與收件人看到的句子', () => {
    expect(toNotificationOverviewRowVM(base)).toMatchObject({
      recipientId: 'u1',
      recipientName: 'Alice',
      eventNameKey: 'notification.event.type.webhookDisabled.name',
      message: {
        key: 'notification.message.webhookDisabled',
        args: { name: { text: 'CI' }, count: { count: 5 } },
      },
      actorName: null,
      readAt: null,
    });
  });

  it('不認得的事件：沒有名稱 key（畫面顯示 type），句子退回通用文字', () => {
    const row = toNotificationOverviewRowVM({ ...base, type: 'future.event', params: {} });
    expect(row.eventNameKey).toBeUndefined();
    expect(row.type).toBe('future.event');
    expect(row.message.key).toBe('notification.message.unknown');
  });
});
