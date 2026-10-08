import { describe, expect, it } from 'vitest';

import { parseProcessRoles, processRolesOf, rolesLabelOf } from '../process-roles';

describe('程序角色（docs/architecture/01-system.md §4.3）', () => {
  it('all 是三個角色', () => {
    expect([...(parseProcessRoles('all') ?? [])]).toEqual(['http', 'realtime', 'worker']);
  });

  it('逗號分隔、忽略空白與空項目', () => {
    expect([...(parseProcessRoles(' worker, http ,') ?? [])]).toEqual(['worker', 'http']);
  });

  it.each(['', 'api', 'http,all', ' , '])('格式不對 → undefined：%j', (value) => {
    expect(parseProcessRoles(value)).toBeUndefined();
  });

  it('沒設定 = 單體', () => {
    expect(processRolesOf({}).size).toBe(3);
  });

  it.each([
    ['all', 'all'],
    ['http,realtime,worker', 'all'],
    ['http', 'http'],
    ['worker,http', 'http,worker'],
  ])('角色的標籤：%s → %s', (value, expected) => {
    expect(rolesLabelOf(processRolesOf({ APP_ROLES: value }))).toBe(expected);
  });
});
