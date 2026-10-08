import { plainTextToRichText } from '@b2b-system/ui/RichTextViewer';
import { setDateTimeDefaults } from '@b2b-system/web-shared/date';
import { afterEach, describe, expect, it } from 'vitest';

import type { Announcement } from '@/shared/api-sdk';

import {
  EMPTY_AUDIENCE,
  EMPTY_DRAFT,
  isDraftDirty,
  restoreDraft,
  toDraft,
  toRequest,
} from '../draft';
import { EMPTY_TRIGGER_DRAFT } from '../triggerDraft';

afterEach(() => setDateTimeDefaults({ timeZone: 'Asia/Taipei' }));

/** 富文本的內文。 */
const body = (text: string) => plainTextToRichText(text);

describe('公告表單的草稿', () => {
  it('內文只有空白或空段落 → 不能存；不合內容規則（例：不安全的連結）也不能存', () => {
    const base = { ...EMPTY_DRAFT, title: '標題', trigger: { ...EMPTY_TRIGGER_DRAFT } };
    expect(toRequest({ ...base, body: body('   ') })).toBeUndefined();
    expect(
      toRequest({
        ...base,
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'x',
                  marks: [{ type: 'link', attrs: { href: 'javascript:x' } }],
                },
              ],
            },
          ],
        },
      }),
    ).toBeUndefined();
    expect(toRequest({ ...base, body: body('內文') })?.body).toEqual(body('內文'));
  });

  it('dirty：標題或內文有字才算', () => {
    expect(isDraftDirty(EMPTY_DRAFT)).toBe(false);
    expect(isDraftDirty({ ...EMPTY_DRAFT, body: body('  ') })).toBe(false);
    expect(isDraftDirty({ ...EMPTY_DRAFT, body: body('x') })).toBe(true);
    expect(isDraftDirty({ ...EMPTY_DRAFT, title: 'x' })).toBe(true);
  });

  it('還原改成富文本之前存下的草稿：純文字的內文轉成文件', () => {
    const legacy = { title: 'T', body: '第一行\n第二行' } as unknown as Partial<typeof EMPTY_DRAFT>;
    expect(restoreDraft(legacy)).toEqual({ title: 'T', body: body('第一行\n第二行') });
    expect(restoreDraft({ body: body('x') })).toEqual({ body: body('x') });
  });

  it('標題或內文空白、指定時間缺日期 → 不能存', () => {
    expect(toRequest(EMPTY_DRAFT)).toBeUndefined();
    expect(toRequest({ ...EMPTY_DRAFT, title: '  ', body: body('內文') })).toBeUndefined();
    expect(
      toRequest({
        ...EMPTY_DRAFT,
        title: '標題',
        body: body('內文'),
        trigger: { ...EMPTY_TRIGGER_DRAFT, kind: 'once', day: '', time: '09:00' },
      }),
    ).toBeUndefined();
  });

  it('受眾空著可以存（送出時才擋）；指定時間以偏好時區換成 ISO', () => {
    setDateTimeDefaults({ timeZone: 'Asia/Taipei' });
    expect(
      toRequest({
        title: ' 維護 ',
        body: body('週六停機'),
        audience: EMPTY_AUDIENCE,
        trigger: { ...EMPTY_TRIGGER_DRAFT, kind: 'once', day: '2026-10-10', time: '18:00' },
      }),
    ).toEqual({
      title: '維護',
      body: body('週六停機'),
      audience: EMPTY_AUDIENCE,
      trigger: { kind: 'once', at: '2026-10-10T10:00:00.000Z' },
    });
  });

  it('既有的公告 → 表單（時間換回偏好時區的日期與時間）', () => {
    setDateTimeDefaults({ timeZone: 'Asia/Taipei' });
    const draft = toDraft({
      title: 'T',
      body: body('B'),
      audience: { ...EMPTY_AUDIENCE, all: true },
      trigger: { kind: 'once', at: '2026-10-10T10:00:00.000Z' },
    } as Announcement);
    expect(draft.trigger).toMatchObject({ kind: 'once', day: '2026-10-10', time: '18:00' });
    expect(draft.audience.all).toBe(true);
  });

  it('週期：每週要選星期幾；只帶該頻率用得到的欄位，時間是租戶時區、原樣送出', () => {
    const base = { title: 'T', body: body('B'), audience: EMPTY_AUDIENCE };
    const weekly = {
      ...EMPTY_TRIGGER_DRAFT,
      kind: 'recurring' as const,
      frequency: 'weekly' as const,
      weekdays: [3, 1],
      monthDay: 15,
      startsOn: '2026-10-01',
      time: '08:30',
    };
    expect(toRequest({ ...base, trigger: { ...weekly, weekdays: [] } })).toBeUndefined();
    expect(toRequest({ ...base, trigger: weekly })?.trigger).toEqual({
      kind: 'recurring',
      frequency: 'weekly',
      interval: 1,
      time: '08:30',
      startsOn: '2026-10-01',
      endsOn: null,
      maxOccurrences: null,
      weekdays: [1, 3],
    });
    expect(
      toRequest({ ...base, trigger: { ...weekly, frequency: 'monthly', endsOn: '2026-09-01' } }),
    ).toBeUndefined();
    expect(
      toRequest({ ...base, trigger: { ...weekly, frequency: 'monthly', monthDay: 'last' } })
        ?.trigger,
    ).toMatchObject({ frequency: 'monthly', monthDay: 'last' });
  });

  it('既有的週期 → 表單（欄位原樣帶回）', () => {
    const draft = toDraft({
      title: 'T',
      body: body('B'),
      audience: EMPTY_AUDIENCE,
      trigger: {
        kind: 'recurring',
        frequency: 'monthly',
        interval: 2,
        monthDay: 'last',
        time: '18:00',
        startsOn: '2026-10-01',
        endsOn: '2027-01-01',
        maxOccurrences: 3,
      },
    } as Announcement);
    expect(draft.trigger).toMatchObject({
      kind: 'recurring',
      frequency: 'monthly',
      interval: 2,
      monthDay: 'last',
      time: '18:00',
      endsOn: '2027-01-01',
      maxOccurrences: 3,
    });
  });

  it('事件點：延遲換成分鐘；沒選事件或超過 30 天不能存；帶回表單時換成最大的整除單位', () => {
    const base = { title: 'T', body: body('B'), audience: EMPTY_AUDIENCE };
    const event = {
      ...EMPTY_TRIGGER_DRAFT,
      kind: 'event' as const,
      event: 'user.activated',
      delayValue: 2,
      delayUnit: 'days' as const,
    };
    expect(toRequest({ ...base, trigger: event })?.trigger).toEqual({
      kind: 'event',
      event: 'user.activated',
      delayMinutes: 2880,
    });
    expect(toRequest({ ...base, trigger: { ...event, event: '' } })).toBeUndefined();
    expect(toRequest({ ...base, trigger: { ...event, delayValue: 31 } })).toBeUndefined();
    const back = toDraft({
      ...base,
      trigger: { kind: 'event', event: 'group.memberAdded', delayMinutes: 90 },
    } as Announcement);
    expect(back.trigger).toMatchObject({
      event: 'group.memberAdded',
      delayValue: 90,
      delayUnit: 'minutes',
    });
  });
});
