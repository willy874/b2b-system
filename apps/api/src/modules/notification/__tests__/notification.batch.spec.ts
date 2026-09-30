import { describe, expect, it } from 'vitest';

import { prepareNotifications } from '../notification.batch';
import { decodeNotificationCursor, encodeNotificationCursor } from '../notification.cursor';
import { defineNotification, notification } from '../notification.definition';
import type { NotificationInput } from '../notification.definition';

const ACTOR = '00000000-0000-4000-8000-000000000001';
const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';

type SampleParams = { name: string; count: number };
const SAMPLE = defineNotification<SampleParams>('sample.happened');

function input(recipientId: string, overrides: Partial<NotificationInput> = {}): NotificationInput {
  return {
    ...notification(SAMPLE, {
      recipientId,
      actorId: ACTOR,
      params: { name: 'x', count: 1 },
      link: { route: 'sample.detail', params: { id: '1' } },
    }),
    ...overrides,
  };
}

describe('defineNotification / notification()（docs/architecture/backend/15-notification.md §3）', () => {
  it('類型不是 <模組>.<事件> → 載入時就失敗', () => {
    expect(() => defineNotification('Approval.pending')).toThrow(/<模組>.<事件>/);
    expect(() => defineNotification('approval')).toThrow(/<模組>.<事件>/);
    expect(() => defineNotification('approval.pending.extra')).toThrow(/<模組>.<事件>/);
  });

  it('組出的輸入帶類型字串，沒給連結時是 null', () => {
    expect(
      notification(SAMPLE, { recipientId: ALICE, actorId: null, params: { name: 'a', count: 2 } }),
    ).toEqual({
      type: 'sample.happened',
      recipientId: ALICE,
      actorId: null,
      params: { name: 'a', count: 2 },
      link: null,
    });
  });

  it('params 與類型不配 → 編譯期失敗', () => {
    notification(SAMPLE, {
      recipientId: ALICE,
      actorId: null,
      // @ts-expect-error -- count 必須是數字（型別由 SAMPLE 決定）
      params: { name: 'a', count: 'two' },
    });
  });
});

describe('prepareNotifications（ADR-0026 D6、D7）', () => {
  it('操作者就是收件人 → 略過', () => {
    const result = prepareNotifications([input(ALICE), input(ACTOR)], 10);
    expect(result.rows.map((row) => row.recipientId)).toEqual([ALICE]);
    expect(result.skippedSelf).toBe(1);
  });

  it('系統觸發（actorId null）不算自己', () => {
    expect(prepareNotifications([input(ALICE, { actorId: null })], 10).rows).toHaveLength(1);
  });

  it('同一類型同一位收件人只留第一筆；不同類型各自保留', () => {
    const other = input(ALICE, { type: 'sample.other' });
    const result = prepareNotifications(
      [input(ALICE, { params: { name: 'first', count: 1 } }), input(BOB), input(ALICE), other],
      10,
    );
    expect(result.rows.map((row) => [row.type, row.recipientId])).toEqual([
      ['sample.happened', ALICE],
      ['sample.happened', BOB],
      ['sample.other', ALICE],
    ]);
    expect(result.rows[0]?.params).toEqual({ name: 'first', count: 1 });
  });

  it('超過上限 → 截斷並回報截掉的筆數', () => {
    const recipients = Array.from(
      { length: 5 },
      (_, i) => `00000000-0000-4000-8000-00000000010${i}`,
    );
    const result = prepareNotifications(
      recipients.map((id) => input(id)),
      3,
    );
    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(2);
  });

  it.each([
    ['收件人不是 uuid', input('alice')],
    ['類型格式不對', input(ALICE, { type: 'Bad' })],
    ['route id 格式不對', input(ALICE, { link: { route: '/approval/1', params: {} } })],
    [
      'params 太大',
      input(ALICE, {
        params: Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [`k${i}`, 'x'.repeat(450)]),
        ),
      }),
    ],
    ['params 的值不是純量或字串陣列', input(ALICE, { params: { nested: { a: 1 } } as never })],
  ])('%s → 拋錯（呼叫端的程式錯誤，讓業務交易一起失敗）', (_, bad) => {
    expect(() => prepareNotifications([bad], 10)).toThrow(/不合格式/);
  });
});

describe('通知列表的游標', () => {
  it('編碼後解得回來（微秒精度原樣保留）', () => {
    const cursor = { createdAt: '2026-10-01T01:02:03.123456Z', id: ALICE };
    expect(decodeNotificationCursor(encodeNotificationCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['不是 base64 的 JSON', 'not-a-cursor'],
    ['欄位數不對', Buffer.from(JSON.stringify(['2026-10-01T00:00:00Z'])).toString('base64url')],
    ['時間不合法', Buffer.from(JSON.stringify(['yesterday', ALICE])).toString('base64url')],
    [
      'id 不是 uuid',
      Buffer.from(JSON.stringify(['2026-10-01T00:00:00Z', 'x'])).toString('base64url'),
    ],
  ])('%s → undefined', (_, raw) => {
    expect(decodeNotificationCursor(raw)).toBeUndefined();
  });
});
