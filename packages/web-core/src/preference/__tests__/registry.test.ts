import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n, loadLocaleScope } from '../../locales';
import type * as Locales from '../../locales';
import {
  getPreferenceSections,
  getPreferenceTable,
  getPreferenceTables,
  preferenceLocaleLoader,
  registerPreferenceSection,
  registerPreferenceTable,
  resetPreferenceRegistry,
} from '../registry';

vi.mock('../../locales', async (importOriginal) => ({
  ...(await importOriginal<typeof Locales>()),
  loadLocaleScope: vi.fn(async () => undefined),
}));

const USER_TABLE = {
  id: 'user-list',
  labelI18nKey: 'user.list.title',
  columnLabelKeys: { displayName: 'user.field.displayName' },
};

describe('偏好頁的列表註冊表', () => {
  beforeEach(() => resetPreferenceRegistry());

  it('依登記順序列出，並可用 id 查詢', () => {
    registerPreferenceTable(USER_TABLE);
    registerPreferenceTable({ ...USER_TABLE, id: 'role-list' });
    expect(getPreferenceTables().map((table) => table.id)).toEqual(['user-list', 'role-list']);
    expect(getPreferenceTable('role-list')?.id).toBe('role-list');
    expect(getPreferenceTable('missing')).toBeUndefined();
  });

  it('同一個 id 登記兩次會拋錯（兩個 feature 用了同一個 tableId）', () => {
    registerPreferenceTable(USER_TABLE);
    expect(() => registerPreferenceTable(USER_TABLE)).toThrow('user-list');
  });
});

const section = (key: string, order: number, localeScope?: string) => ({
  key,
  order,
  labelI18nKey: `${key}.title`,
  Component: () => null,
  ...(localeScope ? { localeScope } : {}),
});

describe('偏好頁的分頁註冊表', () => {
  beforeEach(() => resetPreferenceRegistry());

  it('依 order 排序，不依登記順序', () => {
    registerPreferenceSection(section('security', 30));
    registerPreferenceSection(section('general', 10));
    registerPreferenceSection(section('notification', 20));

    expect(getPreferenceSections().map((item) => item.key)).toEqual([
      'general',
      'notification',
      'security',
    ]);
  });

  it('反註冊後不再列出（feature 在執行期卸載）', () => {
    const unregister = registerPreferenceSection(section('mfa', 10));
    unregister();
    expect(getPreferenceSections()).toEqual([]);
  });
});

describe('preferenceLocaleLoader（偏好頁的 route loader）', () => {
  beforeEach(() => resetPreferenceRegistry());
  afterEach(() => vi.mocked(loadLocaleScope).mockClear());

  it('下載頁面自己、各分頁與各列表名稱所在的 scope，重複的只下載一次', async () => {
    registerPreferenceSection(section('mfa', 10, 'mfa'));
    registerPreferenceSection(section('general', 20));
    registerPreferenceTable({ ...USER_TABLE, localeScope: 'user' });
    registerPreferenceTable({ ...USER_TABLE, id: 'role-list', localeScope: 'user' });

    await preferenceLocaleLoader('preference', 'mfa')();

    const scopes = vi.mocked(loadLocaleScope).mock.calls.map(([scope]) => scope);
    expect(scopes.toSorted()).toEqual(['mfa', 'preference', 'user']);
    expect(vi.mocked(loadLocaleScope).mock.calls[0]?.[1]).toBe(i18n.language);
  });
});
