import { describe, expect, it } from 'vitest';

import { NotificationEventCatalog } from '../notification-event.catalog';
import { defineNotification } from '../notification.definition';

const A = defineNotification('sample.first', { category: 'sample', channels: ['inApp'] });
const B = defineNotification('sample.second', { category: 'sample', channels: ['email'] });

describe('NotificationEventCatalog（docs/architecture/backend/16-notification-event.md §9.2 D1、D2）', () => {
  it('list 依登記順序列出，跨多次 register 累加', () => {
    const catalog = new NotificationEventCatalog();
    catalog.register([B]);
    catalog.register([A]);
    expect(catalog.list().map((kind) => kind.type)).toEqual(['sample.second', 'sample.first']);
  });

  it('已登記的類型 find 與 get 都取回同一份宣告', () => {
    const catalog = new NotificationEventCatalog();
    catalog.register([A]);
    expect(catalog.find('sample.first')).toBe(A);
    expect(catalog.get('sample.first')).toBe(A);
  });

  it('同一批裡重複也拋錯', () => {
    const catalog = new NotificationEventCatalog();
    expect(() => catalog.register([A, A])).toThrow(/重複登記/);
  });

  it('list 回傳複本，改它不影響目錄', () => {
    const catalog = new NotificationEventCatalog();
    catalog.register([A]);
    catalog.list().pop();
    expect(catalog.list()).toHaveLength(1);
  });
});
