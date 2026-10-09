import { hasLocaleKey } from '@b2b-system/web-core/testing';
import { describe, expect, it } from 'vitest';

import { JOB_NAME_LABEL_KEY, jobNameLabelKey } from '../constants';
import enUS from '../locales/en_US.json';
import zhTW from '../locales/zh_TW.json';

/** 每種工作都有 key 由型別保證（`satisfies Record<…JobName, string>`）；這裡確認 key 真的有翻譯。 */
describe('JOB_NAME_LABEL_KEY', () => {
  it.each([
    ['zh_TW', zhTW],
    ['en_US', enUS],
  ])('%s：每個工作的顯示名稱都有翻譯', (_, bundle) => {
    const missing = Object.values(JOB_NAME_LABEL_KEY).filter((key) => !hasLocaleKey(bundle, key));
    expect(missing).toEqual([]);
  });
});

describe('jobNameLabelKey', () => {
  it('已知的工作回 key，不認得的（前端比後端舊）回 undefined', () => {
    expect(jobNameLabelKey('trash.purge')).toBe('job.name.trashPurge');
    expect(jobNameLabelKey('mail.send')).toBeUndefined();
    expect(jobNameLabelKey('toString')).toBeUndefined();
  });
});
