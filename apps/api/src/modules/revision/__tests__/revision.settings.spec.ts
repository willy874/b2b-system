import { describe, expect, it } from 'vitest';

import { resolveSetting } from '@/core/settings';
import type { EnvReader } from '@/core/settings';

import {
  REVISION_KEEP_DAYS_SETTING,
  REVISION_KEEP_VERSIONS_SETTING,
  REVISION_SETTINGS,
} from '../revision.settings';

/** 版本歷史的設定不依賴 env；讀到 env 就是寫錯了。 */
const noEnv: EnvReader = (key) => {
  throw new Error(`版本歷史的設定不應讀取 env：${String(key)}`);
};

const keepVersions = resolveSetting(REVISION_KEEP_VERSIONS_SETTING, noEnv);
const keepDays = resolveSetting(REVISION_KEEP_DAYS_SETTING, noEnv);

describe('版本歷史的系統設定（docs/architecture/backend/14-revisions.md §5、§9.2 D1）', () => {
  it('預設保留最新 50 版、90 天內的版本', () => {
    expect([keepVersions.defaultValue, keepDays.defaultValue]).toEqual([50, 90]);
  });

  it('都不公開（未登入讀不到）', () => {
    expect(REVISION_SETTINGS.map((setting) => setting.isPublic)).toEqual([false, false]);
  });

  it.each([
    [1, true],
    [50, true],
    [1000, true],
    [0, false],
    [1001, false],
    [1.5, false],
    ['50', false],
  ])('revision.keepVersions = %j → 接受 %s（最新一版永遠保留，下限 1）', (value, accepted) => {
    expect(keepVersions.schema.safeParse(value).success).toBe(accepted);
  });

  it.each([
    [1, true],
    [3650, true],
    [0, false],
    [3651, false],
    [-1, false],
    [7.5, false],
  ])('revision.keepDays = %j → 接受 %s', (value, accepted) => {
    expect(keepDays.schema.safeParse(value).success).toBe(accepted);
  });
});
