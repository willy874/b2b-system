import { describe, expect, it } from 'vitest';

import { decodeNotificationCursor, encodeNotificationCursor } from '../notification.cursor';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const MICROS = '2026-10-01T08:30:00.123456Z';

function raw(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

describe('notification.cursor（docs/architecture/backend/15-notification.md §5）', () => {
  it('encode 之後 decode 取回原值，微秒精度不被截掉', () => {
    const cursor = { createdAt: MICROS, id: ID };
    expect(decodeNotificationCursor(encodeNotificationCursor(cursor))).toEqual(cursor);
  });

  it('encode 的結果是 URL 安全的 base64（不含 +、/、=）', () => {
    const encoded = encodeNotificationCursor({ createdAt: MICROS, id: ID });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('毫秒精度（toISOString 的退路）也接受', () => {
    const millis = '2026-10-01T08:30:00.123Z';
    expect(decodeNotificationCursor(raw([millis, ID]))).toEqual({ createdAt: millis, id: ID });
  });

  it('id 大寫的 uuid 也接受', () => {
    expect(decodeNotificationCursor(raw([MICROS, ID.toUpperCase()]))).toEqual({
      createdAt: MICROS,
      id: ID.toUpperCase(),
    });
  });

  it.each([
    ['不是 base64 的 JSON', 'garbage'],
    ['空字串', ''],
    ['不是陣列', raw({ createdAt: MICROS, id: ID })],
    ['陣列只有一個元素', raw([MICROS])],
    ['陣列多一個元素', raw([MICROS, ID, 'x'])],
    ['時間不是字串', raw([Date.parse(MICROS), ID])],
    ['時間無法解析', raw(['not-a-date', ID])],
    // V8 的 Date.parse 比 Postgres 寬鬆：這些 Date.parse 都回數字，Postgres 卻拒絕轉成 timestamptz（→ 500）
    ['不存在的日期（2 月 30 日）', raw(['2026-02-30T00:00:00.000000Z', ID])],
    ['只有年份', raw(['2026', ID])],
    ['只有一個數字', raw(['0', ID])],
    ['沒有小數秒', raw(['2026-10-01T08:30:00Z', ID])],
    ['不是 UTC', raw(['2026-10-01T08:30:00.123456+08:00', ID])],
    ['24 點', raw(['2026-10-01T24:00:00.000000Z', ID])],
    ['西元 0 年（Postgres 沒有）', raw(['0000-01-01T00:00:00.000000Z', ID])],
    ['id 不是字串', raw([MICROS, 42])],
    ['id 不是 uuid', raw([MICROS, 'n1'])],
    ['id 是 uuid 加上 SQL 片段', raw([MICROS, `${ID}' OR 1=1`])],
    ['JSON 是 null', raw(null)],
  ])('格式不對（%s）→ undefined', (_label, input) => {
    expect(decodeNotificationCursor(input)).toBeUndefined();
  });
});
