import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSION_KEYS,
  assertPermissionDependencies,
  implyingPermissions,
  permissionClosure,
  validatePermissionDependencies,
} from '../permissions';
import type { PermissionDependencyMap } from '../permissions';

const check = (deps: PermissionDependencyMap) => validatePermissionDependencies(deps);

describe('權限依賴樹（docs/architecture/iam/02-permission-catalog.md §9）', () => {
  it('目錄內建的依賴樹通過 G1–G4', () => {
    expect(validatePermissionDependencies()).toEqual([]);
    expect(() => assertPermissionDependencies()).not.toThrow();
  });

  it('delete ⇒ update ⇒ read ⇒ access（遞迴閉包）', () => {
    expect([...permissionClosure(['file:delete'])].toSorted()).toEqual(
      ['file:access', 'file:delete', 'file:read', 'file:update'].toSorted(),
    );
  });

  it('規則 A：file:create 只帶 read，不帶 update', () => {
    const closure = permissionClosure(['file:create']);
    expect(closure.has('file:read')).toBe(true);
    expect(closure.has('file:update')).toBe(false);
  });

  it('user:update 包含 user:resetPassword，反之不成立', () => {
    expect(permissionClosure(['user:update']).has('user:resetPassword')).toBe(true);
    expect(permissionClosure(['user:resetPassword']).has('user:update')).toBe(false);
  });

  it('依賴可以跨資源：user:assignRole 帶 role:read，但不帶 user:update', () => {
    const closure = permissionClosure(['user:assignRole']);
    expect(closure.has('role:read')).toBe(true);
    expect(closure.has('user:update')).toBe(false);
  });

  it('受反提權限制的鍵不會出現在任何其他鍵的閉包裡', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      const implied = permissionClosure([key]);
      implied.delete(key);
      expect(implied.has('user:assignRole')).toBe(false);
      expect(implied.has('role:grantPermission')).toBe(false);
      expect(implied.has('file:share')).toBe(false);
    }
  });

  it('implyingPermissions 列出（遞迴）帶來這個鍵的明確鍵', () => {
    expect(implyingPermissions('file:read', ['file:delete', 'file:share', 'user:read'])).toEqual([
      'file:delete',
      'file:share',
    ]);
    expect(implyingPermissions('file:delete', ['file:delete'])).toEqual([]);
  });

  describe('不變條件的反例', () => {
    it('G1：循環', () => {
      expect(
        check({
          'file:read': { includes: ['file:update'] },
          'file:update': { includes: ['file:read'] },
        }),
      ).toEqual(expect.arrayContaining([expect.stringContaining('G1')]));
    });

    it('G2：子能力跨資源', () => {
      expect(check({ 'user:update': { includes: ['role:read'] } })).toEqual([
        expect.stringContaining('G2'),
      ]);
    });

    it('G3：依賴指向寫入能力', () => {
      expect(check({ 'user:assignRole': { requires: ['role:update'] } })).toEqual([
        expect.stringContaining('G3'),
      ]);
    });

    it('G4：受反提權限制的鍵被包含', () => {
      expect(check({ 'user:update': { includes: ['user:assignRole'] } })).toEqual([
        expect.stringContaining('G4'),
      ]);
    });

    it('指到目錄外的鍵', () => {
      expect(check({ 'user:update': { includes: ['user:nope' as never] } })).toEqual([
        expect.stringContaining('不在權限目錄裡'),
      ]);
    });
  });
});
