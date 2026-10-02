import { afterEach, describe, expect, it } from 'vitest';

import type { Announcement } from '@/shared/api-sdk';
import { setDateTimeDefaults } from '@/shared/date';

import { EMPTY_AUDIENCE, EMPTY_DRAFT, toDraft, toRequest } from '../draft';

afterEach(() => setDateTimeDefaults({ timeZone: 'Asia/Taipei' }));

describe('公告表單的草稿', () => {
  it('標題或內文空白、指定時間缺日期 → 不能存', () => {
    expect(toRequest(EMPTY_DRAFT)).toBeUndefined();
    expect(toRequest({ ...EMPTY_DRAFT, title: '  ', body: '內文' })).toBeUndefined();
    expect(
      toRequest({
        ...EMPTY_DRAFT,
        title: '標題',
        body: '內文',
        trigger: { kind: 'once', day: '', time: '09:00' },
      }),
    ).toBeUndefined();
  });

  it('受眾空著可以存（送出時才擋）；指定時間以偏好時區換成 ISO', () => {
    setDateTimeDefaults({ timeZone: 'Asia/Taipei' });
    expect(
      toRequest({
        title: ' 維護 ',
        body: ' 週六停機 ',
        audience: EMPTY_AUDIENCE,
        trigger: { kind: 'once', day: '2026-10-10', time: '18:00' },
      }),
    ).toEqual({
      title: '維護',
      body: '週六停機',
      audience: EMPTY_AUDIENCE,
      trigger: { kind: 'once', at: '2026-10-10T10:00:00.000Z' },
    });
  });

  it('既有的公告 → 表單（時間換回偏好時區的日期與時間）', () => {
    setDateTimeDefaults({ timeZone: 'Asia/Taipei' });
    const draft = toDraft({
      title: 'T',
      body: 'B',
      audience: { ...EMPTY_AUDIENCE, all: true },
      trigger: { kind: 'once', at: '2026-10-10T10:00:00.000Z' },
    } as Announcement);
    expect(draft.trigger).toEqual({ kind: 'once', day: '2026-10-10', time: '18:00' });
    expect(draft.audience.all).toBe(true);
  });
});
