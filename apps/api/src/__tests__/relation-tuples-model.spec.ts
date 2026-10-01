import { describe, expect, it } from 'vitest';

import {
  buildTenantType,
  createModel,
  GROUP_TYPE,
  ROLE_TYPE,
  USER_TYPE,
  validateTuple,
} from '@/core/authz';
import {
  groupMemberTuple,
  groupRoleTuple,
  roleHolderTuple,
  rolePermissionTuple,
  superAdminTuple,
} from '@/db/schema';
import { FILE_AUTHZ_TYPES } from '@/modules/file/file.authz';

/**
 * 寫入時的模型驗證（docs/adr/0024-relationship-based-access-control.md G4）：邊只由 `db/schema/relation-tuples.ts` 的建構函式
 * （與資料夾授權的 repository）產生，所以在這裡把每一種形狀對完整的模型驗一次——模型或建構函式改錯時測試失敗，
 * 而不是寫進去一條解析時永遠不成立的邊。
 */
const model = createModel([
  USER_TYPE,
  GROUP_TYPE,
  ROLE_TYPE,
  buildTenantType({ withDependencies: true }),
  ...FILE_AUTHZ_TYPES,
]);

describe('關係圖的邊符合模型（寫入時的驗證）', () => {
  it.each([
    ['使用者持有角色', roleHolderTuple('r1', 'u1')],
    ['角色帶的權限鍵', rolePermissionTuple('r1', 'file:update')],
    ['super-admin', superAdminTuple('r1')],
    ['群組的使用者成員', groupMemberTuple('g1', { type: 'user', id: 'u1' })],
    ['巢狀群組', groupMemberTuple('g1', { type: 'group', id: 'g2' })],
    ['群組持有角色', groupRoleTuple('r1', 'g1')],
  ])('%s', (_name, tuple) => {
    expect(validateTuple(model, tuple)).toBeUndefined();
  });

  it.each([
    ['角色', 'role', 'r1', 'holder'],
    ['個人', 'user', 'u1', ''],
    ['所有人', 'user', '*', ''],
    ['群組', 'group', 'g1', 'member'],
  ])('資料夾授權：%s', (_name, subjectType, subjectId, subjectRelation) => {
    const tuple = {
      objectType: 'fileFolder',
      relation: 'editor',
      subjectType,
      subjectId,
      subjectRelation,
    };
    expect(validateTuple(model, tuple)).toBeUndefined();
  });

  it('不合法的形狀回傳說明', () => {
    // 未知的權限鍵、計算出來的關係、不允許的主體種類、萬用字元寫在不接受它的關係上
    expect(validateTuple(model, rolePermissionTuple('r1', 'file:fly'))).toContain('關係不存在');
    expect(
      validateTuple(model, {
        objectType: 'fileFolder',
        relation: 'can_read',
        subjectType: 'user',
        subjectId: 'u1',
      }),
    ).toContain('不是直接關係');
    expect(
      validateTuple(model, {
        objectType: 'group',
        relation: 'member',
        subjectType: 'role',
        subjectId: 'r1',
        subjectRelation: 'holder',
      }),
    ).toContain('不在允許的種類');
    expect(
      validateTuple(model, {
        objectType: 'role',
        relation: 'holder',
        subjectType: 'user',
        subjectId: '*',
      }),
    ).toContain('不在允許的種類');
  });
});
