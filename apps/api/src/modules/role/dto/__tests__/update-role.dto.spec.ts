import { describe, expect, it } from 'vitest';

import { UpdateRolePermissionsSchema, UpdateRoleSchema } from '../update-role.dto';

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

describe('UpdateRoleSchema', () => {
  it('只帶 version（樂觀鎖）不算有要改的欄位 → 驗證失敗', () => {
    expect(UpdateRoleSchema.safeParse({ version: 2 }).success).toBe(false);
  });

  it('欄位 ＋ version → 通過', () => {
    expect(UpdateRoleSchema.parse({ name: 'Editor', version: 2 })).toEqual({
      name: 'Editor',
      version: 2,
    });
  });

  it('不帶 version → 驗證失敗（ADR-0025 D4 的 R1b：必填）', () => {
    expect(UpdateRoleSchema.safeParse({ name: 'Editor' }).success).toBe(false);
  });

  it('version 必須是 ≥ 1 的整數', () => {
    expect(UpdateRoleSchema.safeParse({ name: 'Editor', version: 0 }).success).toBe(false);
    expect(UpdateRoleSchema.safeParse({ name: 'Editor', version: 1.5 }).success).toBe(false);
  });
});
