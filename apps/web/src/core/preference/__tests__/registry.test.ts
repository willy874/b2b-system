import { beforeEach, describe, expect, it } from 'vitest';

import {
  getPreferenceTable,
  getPreferenceTables,
  registerPreferenceTable,
  resetPreferenceRegistry,
} from '../registry';

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
