import { describe, expect, it } from 'vitest';

import { notificationTypeOptions } from '../useNotificationOverviewFilters';

describe('notificationTypeOptions（通知總覽的事件類型，docs/architecture/frontend/02-plugin-system.md §7）', () => {
  it('所有 feature 都啟用 → 列出全部的事件', () => {
    expect(notificationTypeOptions(() => true)).toEqual(
      expect.arrayContaining([
        'approval.pending',
        'approval.progress',
        'webhook.disabled',
        'announcement.published',
        'dataTransfer.exportFinished',
      ]),
    );
  });

  it('只有常駐的 → 屬於可啟用 feature 的事件不列出（與後端 defineNotification 的 feature 相同）', () => {
    const options = notificationTypeOptions((feature) => feature === null);
    expect(options).toEqual(
      expect.arrayContaining([
        'approval.pending',
        'approval.result',
        'user.rolesChanged',
        'comment.mentioned',
      ]),
    );
    for (const type of [
      'approval.progress',
      'approval.unassigned',
      'webhook.disabled',
      'announcement.published',
      'dataTransfer.exportFinished',
      'dataTransfer.importFinished',
    ]) {
      expect(options).not.toContain(type);
    }
  });

  it('只關掉 Webhook → 只少「Webhook 被停用」', () => {
    const all = notificationTypeOptions(() => true);
    expect(notificationTypeOptions((feature) => feature !== 'webhook')).toEqual(
      all.filter((type) => type !== 'webhook.disabled'),
    );
  });
});
