import { describe, expect, it } from 'vitest';

import { WebhookEventCatalog } from '../webhook-event.catalog';
import { WEBHOOK_PING_EVENT } from '../webhook.constants';
import { defineWebhookEvent } from '../webhook.definition';

const USER_CREATED = defineWebhookEvent('user.created', { version: 1 });
const FILE_UPLOADED = defineWebhookEvent('file.uploaded', { version: 1, feature: 'file' });

function catalog(): WebhookEventCatalog {
  const result = new WebhookEventCatalog();
  result.register([FILE_UPLOADED, USER_CREATED]);
  result.register([WEBHOOK_PING_EVENT]);
  return result;
}

describe('WebhookEventCatalog（docs/architecture/backend/17-webhook.md §9.2 D1、D8）', () => {
  it('subscribable：依登記順序，所屬 feature 已啟用的才列出，不屬於 feature 的一律列出', () => {
    expect(
      catalog()
        .subscribable(['file'])
        .map((event) => event.type),
    ).toEqual(['file.uploaded', 'user.created']);
    expect(
      catalog()
        .subscribable([])
        .map((event) => event.type),
    ).toEqual(['user.created']);
  });

  it('isSubscribable 不看 feature：feature 關著也能先訂閱', () => {
    expect(catalog().isSubscribable('file.uploaded')).toBe(true);
  });

  it('沒有登記的事件不能訂閱', () => {
    expect(catalog().isSubscribable('role.created')).toBe(false);
  });

  it('沒有登記的事件 → assertRegistered 拋錯；登記過的不拋', () => {
    expect(() => catalog().assertRegistered('role.created')).toThrow('沒有登記');
    expect(() => catalog().assertRegistered('user.created')).not.toThrow();
  });

  it('同一批裡重複也拋錯', () => {
    expect(() => new WebhookEventCatalog().register([USER_CREATED, USER_CREATED])).toThrow(
      '重複登記',
    );
  });
});
