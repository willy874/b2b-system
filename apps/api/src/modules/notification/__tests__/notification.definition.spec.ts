import { describe, expect, it } from 'vitest';

import {
  defineNotification,
  isNotificationType,
  isRouteId,
  notification,
} from '../notification.definition';
import type { NotificationEventMeta } from '../notification.definition';

const META: NotificationEventMeta = { category: 'sample', channels: ['inApp'] };

describe('defineNotification（docs/architecture/backend/16-notification-event.md §9.2 D1）', () => {
  it('沒給的中繼資料採預設：預設開啟、可關、不屬於 feature、允許個人調整', () => {
    expect(defineNotification('sample.happened', META)).toEqual({
      type: 'sample.happened',
      category: 'sample',
      channels: ['inApp'],
      defaultEnabled: true,
      mandatory: false,
      feature: null,
      defaultAllowUserOverride: true,
    });
  });

  it('給了的中繼資料原樣保留', () => {
    expect(
      defineNotification('sample.happened', {
        category: 'sample',
        channels: ['inApp', 'email'],
        defaultEnabled: false,
        feature: 'webhook',
        defaultAllowUserOverride: false,
      }),
    ).toMatchObject({
      channels: ['inApp', 'email'],
      defaultEnabled: false,
      feature: 'webhook',
      defaultAllowUserOverride: false,
    });
  });

  it('管道複製一份，事後改宣告用的陣列不影響已宣告的類型', () => {
    const channels: Array<'inApp' | 'email'> = ['inApp'];
    const kind = defineNotification('sample.happened', { category: 'sample', channels });
    channels.push('email');
    expect(kind.channels).toEqual(['inApp']);
  });

  it.each([
    ['類型不是 <模組>.<事件>', 'happened', META, /必須是 <模組>.<事件>/],
    ['類型不是 camelCase', 'Sample.happened', META, /必須是 <模組>.<事件>/],
    ['分類不是 camelCase', 'sample.happened', { ...META, category: 'Sample-x' }, /分類/],
    ['管道是空的', 'sample.happened', { ...META, channels: [] }, /管道不可為空或重複/],
    [
      '管道重複',
      'sample.happened',
      { ...META, channels: ['inApp', 'inApp'] },
      /管道不可為空或重複/,
    ],
    [
      'mandatory 卻預設關閉',
      'sample.happened',
      { ...META, mandatory: true, defaultEnabled: false },
      /mandatory/,
    ],
  ] as const)('%s → 宣告時就拋錯', (_label, type, meta, message) => {
    expect(() => defineNotification(type, meta as NotificationEventMeta)).toThrow(message);
  });

  it('mandatory 且預設開啟可以宣告', () => {
    expect(defineNotification('sample.security', { ...META, mandatory: true })).toMatchObject({
      mandatory: true,
      defaultEnabled: true,
    });
  });
});

describe('isNotificationType／isRouteId（docs/architecture/backend/15-notification.md §12.2 D3）', () => {
  it.each([
    ['approval.pending', true],
    ['user.rolesChanged', true],
    ['user2.changed3', true],
    ['approval', false],
    ['approval.pending.extra', false],
    ['Approval.pending', false],
    ['approval.Pending', false],
    ['approval_x.pending', false],
    ['', false],
  ])('isNotificationType(%j) → %s', (type, expected) => {
    expect(isNotificationType(type)).toBe(expected);
  });

  it.each([
    ['approval.detail', true],
    ['user.detail.roles', true],
    ['approval', false],
    ['approval.', false],
    ['Approval.detail', false],
    ['approval/detail', false],
  ])('isRouteId(%j) → %s', (route, expected) => {
    expect(isRouteId(route)).toBe(expected);
  });
});

describe('notification()（docs/architecture/backend/15-notification.md §12.2 D2）', () => {
  const KIND = defineNotification<{ name: string }>('sample.happened', META);

  it('沒給連結時是 null，沒給來源時不帶 sourceId', () => {
    expect(notification(KIND, { recipientId: 'u1', actorId: null, params: { name: 'x' } })).toEqual(
      {
        type: 'sample.happened',
        recipientId: 'u1',
        actorId: null,
        params: { name: 'x' },
        link: null,
      },
    );
  });

  it('給了連結與來源時原樣帶上', () => {
    const link = { route: 'sample.detail', params: { id: '1' } };
    expect(
      notification(KIND, {
        recipientId: 'u1',
        actorId: 'a1',
        params: { name: 'x' },
        link,
        sourceId: 's1',
      }),
    ).toMatchObject({ actorId: 'a1', link, sourceId: 's1' });
  });

  it('sourceId 是 null 時不帶 sourceId', () => {
    expect(
      notification(KIND, {
        recipientId: 'u1',
        actorId: null,
        params: { name: 'x' },
        sourceId: null,
      }),
    ).not.toHaveProperty('sourceId');
  });
});
