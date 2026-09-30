import { describe, expect, it } from 'vitest';

import type { SystemSetting } from '@/shared/api-sdk';

import { toDisplayNumber, toRawNumber, toSettingCategories } from '../adapter';

function setting(overrides: Partial<SystemSetting>): SystemSetting {
  return {
    key: 'auth.loginMaxAttempts',
    category: 'auth',
    type: 'number',
    value: 5,
    defaultValue: 5,
    isOverridden: false,
    isPublic: false,
    minimum: 3,
    maximum: 20,
    updatedAt: null,
    ...overrides,
  };
}

describe('toSettingCategories', () => {
  it('依固定的分類順序分組，沒有設定的分類不出現', () => {
    const views = toSettingCategories([
      setting({ key: 'file.uploadMaxSize', category: 'file' }),
      setting({ key: 'auth.loginMaxAttempts', category: 'auth' }),
    ]);
    expect(views.map((view) => view.category)).toEqual(['auth', 'file']);
  });

  it('已知的 key 帶出標籤與單位；未知的 key 沒有標籤（畫面以 key 顯示）', () => {
    const [auth] = toSettingCategories([
      setting({ key: 'auth.loginMaxAttempts' }),
      setting({ key: 'auth.somethingNew' }),
    ]);
    expect(auth!.fields[0]).toMatchObject({
      labelKey: 'setting.field.loginMaxAttempts.label',
      unit: { labelKey: 'setting.unit.times', scale: 1 },
    });
    expect(auth!.fields[1]!.labelKey).toBeUndefined();
  });
});

describe('單位換算', () => {
  const MIB = 1024 * 1024;
  const mebibytes = { labelKey: 'setting.unit.mebibytes', scale: MIB };

  it('位元組 ↔ MiB', () => {
    expect(toDisplayNumber(100 * MIB, mebibytes)).toBe(100);
    expect(toRawNumber(1.5, mebibytes)).toBe(1.5 * MIB);
  });

  it('沒有單位時原樣', () => {
    expect(toDisplayNumber(900, undefined)).toBe(900);
    expect(toRawNumber(900, undefined)).toBe(900);
  });
});
