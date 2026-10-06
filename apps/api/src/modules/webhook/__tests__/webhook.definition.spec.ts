import { describe, expect, it } from 'vitest';

import { defineWebhookEvent } from '../webhook.definition';

describe('defineWebhookEvent（docs/architecture/backend/17-webhook.md §9.2 D1～D4）', () => {
  it('沒給的中繼資料採預設：不屬於 feature、可以訂閱', () => {
    expect(defineWebhookEvent('user.created', { version: 1 })).toEqual({
      type: 'user.created',
      version: 1,
      feature: null,
      subscribable: true,
    });
  });

  it('給了 feature 與 subscribable 原樣保留', () => {
    expect(
      defineWebhookEvent('file.uploaded', { version: 2, feature: 'file', subscribable: false }),
    ).toEqual({ type: 'file.uploaded', version: 2, feature: 'file', subscribable: false });
  });

  it.each([
    ['user.created', true],
    ['user.statusChanged', true],
    ['webhook.ping', true],
    ['user', false],
    ['User.created', false],
    ['user.Created', false],
    ['user.created.v2', false],
    ['user-x.created', false],
    ['', false],
  ])('名稱 %j 合法 → %s', (type, ok) => {
    const define = () => defineWebhookEvent(type, { version: 1 });
    if (ok) expect(define).not.toThrow();
    else expect(define).toThrow('<資源>.<動作>');
  });

  it.each([0, -1, 1.5, Number.NaN])('版本 %s 不是正整數 → 拋錯', (version) => {
    expect(() => defineWebhookEvent('user.created', { version })).toThrow('正整數');
  });
});
