import { beforeAll, describe, expect, it } from 'vitest';

import { i18n } from '@/core/locales';
import { setDateTimeDefaults } from '@/shared/date';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { describeTrigger } from '../triggerSummary';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

beforeAll(async () => {
  await initTestI18n(zhTW);
  setDateTimeDefaults({ timeZone: 'Asia/Taipei' });
});

const base = { kind: 'recurring' as const, time: '09:00', startsOn: '2026-10-01' };

describe('describeTrigger（觸發方式的摘要）', () => {
  it('立即、週期（每天、每 2 週的週一與週三、每月最後一天）', () => {
    expect(describeTrigger(t, 'zh-TW', { kind: 'immediate' })).toBe('立即發送');
    expect(describeTrigger(t, 'zh-TW', { ...base, frequency: 'daily', interval: 1 })).toBe(
      '每天 09:00',
    );
    expect(
      describeTrigger(t, 'zh-TW', { ...base, frequency: 'weekly', interval: 2, weekdays: [3, 1] }),
    ).toBe('每 2 週的週一和週三 09:00');
    expect(
      describeTrigger(t, 'zh-TW', { ...base, frequency: 'monthly', interval: 1, monthDay: 'last' }),
    ).toBe('每月最後一天 09:00');
  });
});
