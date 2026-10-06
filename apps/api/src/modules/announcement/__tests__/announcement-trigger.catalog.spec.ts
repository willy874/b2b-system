import { describe, expect, it } from 'vitest';

import { AnnouncementTriggerCatalog } from '../announcement-trigger.catalog';
import { defineAnnouncementTrigger } from '../announcement.triggers';

describe('AnnouncementTriggerCatalog（docs/architecture/backend/19-announcement.md §9.2 D12）', () => {
  const ACTIVATED = defineAnnouncementTrigger('user.activated', { scope: 'audience' });
  const MEMBER_ADDED = defineAnnouncementTrigger('group.memberAdded', { scope: 'group' });

  it('依登記的順序列出', () => {
    const catalog = new AnnouncementTriggerCatalog();
    catalog.register([MEMBER_ADDED]);
    catalog.register([ACTIVATED]);
    expect(catalog.list().map((item) => item.event)).toEqual([
      'group.memberAdded',
      'user.activated',
    ]);
  });

  it('重複登記同一個觸發點讓啟動失敗', () => {
    const catalog = new AnnouncementTriggerCatalog();
    catalog.register([ACTIVATED]);
    expect(() => catalog.register([ACTIVATED])).toThrow('user.activated');
  });

  it('find：沒登記回 undefined', () => {
    const catalog = new AnnouncementTriggerCatalog();
    catalog.register([ACTIVATED]);
    expect(catalog.find('user.activated')).toBe(ACTIVATED);
    expect(catalog.find('order.shipped')).toBeUndefined();
  });

  it('get：沒登記是呼叫端的程式錯誤，拋錯', () => {
    const catalog = new AnnouncementTriggerCatalog();
    catalog.register([ACTIVATED]);
    expect(catalog.get('user.activated')).toBe(ACTIVATED);
    expect(() => catalog.get('order.shipped')).toThrow('order.shipped');
  });

  it('list 回傳的是複本：改動它不影響目錄', () => {
    const catalog = new AnnouncementTriggerCatalog();
    catalog.register([ACTIVATED]);
    catalog.list().pop();
    expect(catalog.list()).toHaveLength(1);
  });
});
