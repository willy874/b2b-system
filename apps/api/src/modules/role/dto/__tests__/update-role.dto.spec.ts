import { describe, expect, it } from 'vitest';

import { UpdateRolePermissionsSchema } from '../update-role.dto';

describe('UpdateRolePermissionsSchema', () => {
  it('同一個權限同時在 add 與 remove → 驗證失敗', () => {
    const result = UpdateRolePermissionsSchema.safeParse({
      add: ['user:read'],
      remove: ['user:read'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['remove']);
  });

  it('沒有交集 → 通過', () => {
    const result = UpdateRolePermissionsSchema.safeParse({
      add: ['user:read'],
      remove: ['role:read'],
    });
    expect(result.success).toBe(true);
  });

  it('只帶其中一邊 → 另一邊預設為空陣列', () => {
    expect(UpdateRolePermissionsSchema.parse({ remove: ['user:read'] })).toEqual({
      add: [],
      remove: ['user:read'],
    });
  });
});
