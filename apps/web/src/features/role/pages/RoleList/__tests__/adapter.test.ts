import { describe, expect, it } from 'vitest';

import type { Role } from '@/shared/api-sdk';

import { toRoleRowVM } from '../adapter';

const role: Role = {
  id: 'role-1',
  slug: 'content-editor',
  name: '內容編輯',
  description: null,
  isSystem: false,
  permissionCount: 2,
  userCount: 1,
  createdAt: '2026-09-19T02:10:00.000Z',
  updatedAt: '2026-09-19T02:10:00.000Z',
};

const fullAccess = { canDelete: true, canUpdate: true };

describe('toRoleRowVM', () => {
  it('空描述正規化成 -', () => {
    expect(toRoleRowVM(role, fullAccess).description).toBe('-');
  });

  it('createdAt 轉成 Date（時區交給顯示層）', () => {
    expect(toRoleRowVM(role, fullAccess).createdAt).toBeInstanceOf(Date);
  });

  it('自訂角色：有權限就可以刪除與編輯', () => {
    const vm = toRoleRowVM(role, fullAccess);
    expect(vm.canDelete).toBe(true);
    expect(vm.canEdit).toBe(true);
  });

  it('系統角色：即使有權限也不可刪除或編輯', () => {
    const vm = toRoleRowVM({ ...role, isSystem: true }, fullAccess);
    expect(vm.canDelete).toBe(false);
    expect(vm.canEdit).toBe(false);
  });

  it('沒有權限時衍生旗標為 false', () => {
    const vm = toRoleRowVM(role, { canDelete: false, canUpdate: false });
    expect(vm.canDelete).toBe(false);
    expect(vm.canEdit).toBe(false);
  });
});
