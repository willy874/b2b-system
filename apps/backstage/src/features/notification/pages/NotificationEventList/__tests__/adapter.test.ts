import { describe, expect, it } from 'vitest';

import type { NotificationEvent } from '@/shared/api-sdk';

import { toNotificationEventCategories } from '../adapter';

function event(type: string, category: string): NotificationEvent {
  return {
    type,
    category,
    mandatory: false,
    channels: [
      {
        channel: 'inApp',
        enabled: true,
        defaultEnabled: true,
        isOverridden: false,
        updatedAt: null,
      },
    ],
  };
}

describe('toNotificationEventCategories（ADR-0028 D13）', () => {
  it('依後端目錄的順序分組，認得的事件帶名稱、說明與收件人的 key', () => {
    const views = toNotificationEventCategories([
      event('approval.pending', 'approval'),
      event('user.rolesChanged', 'user'),
      event('approval.result', 'approval'),
    ]);
    expect(views.map((view) => [view.category, view.events.map((item) => item.type)])).toEqual([
      ['approval', ['approval.pending', 'approval.result']],
      ['user', ['user.rolesChanged']],
    ]);
    expect(views[0]).toMatchObject({
      labelKey: 'notification.event.category.approval',
      events: [
        {
          nameKey: 'notification.event.type.approvalPending.name',
          descriptionKey: 'notification.event.type.approvalPending.description',
          recipientsKey: 'notification.event.type.approvalPending.recipients',
        },
        expect.anything(),
      ],
    });
  });

  it('前端不認得的事件與分類（後端比前端新）→ 沒有 key，畫面以原字串顯示', () => {
    const [view] = toNotificationEventCategories([event('tag.mentioned', 'tag')]);
    expect(view).toMatchObject({ category: 'tag', labelKey: undefined });
    expect(view!.events[0]).toMatchObject({
      type: 'tag.mentioned',
      nameKey: undefined,
      descriptionKey: undefined,
      recipientsKey: undefined,
    });
  });
});
