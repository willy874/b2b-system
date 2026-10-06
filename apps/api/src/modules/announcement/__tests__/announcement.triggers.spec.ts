import { describe, expect, it } from 'vitest';

import { defineAnnouncementTrigger } from '../announcement.triggers';

describe('defineAnnouncementTrigger（docs/architecture/backend/19-announcement.md §5.3）', () => {
  it('回傳名稱、比對方式；沒給 feature 時是 null', () => {
    expect(defineAnnouncementTrigger('group.memberAdded', { scope: 'group' })).toEqual({
      event: 'group.memberAdded',
      scope: 'group',
      feature: null,
    });
  });

  it('帶上所屬的 feature', () => {
    expect(
      defineAnnouncementTrigger('file.uploaded', { scope: 'audience', feature: 'file' }).feature,
    ).toBe('file');
  });

  it.each([
    'userActivated',
    'user.activated.again',
    'User.activated',
    'user.Activated',
    'user-x.done',
    'user.',
  ])('名稱不是 <模組>.<事件>（camelCase）：%s 在宣告時就失敗', (event) => {
    expect(() => defineAnnouncementTrigger(event, { scope: 'audience' })).toThrow(event);
  });
});
