import { describe, expect, it } from 'vitest';

import {
  buildPermissionKey,
  definePageKey,
  evaluateAccess,
  PermissionAction,
  PermissionMatch,
  PermissionResource,
} from '..';
import type { PagePermissionRule } from '..';
import { ALL_PERMISSION_KEYS, isPermissionKey, PermissionKey } from '../enums';

describe('權限的代數', () => {
  it('buildPermissionKey 組出 resource:action', () => {
    expect(buildPermissionKey(PermissionResource.ROLE, PermissionAction.UPDATE)).toBe(
      'role:update',
    );
  });

  it('組出後端不核發的鍵也沒關係（該能力恆為 false）', () => {
    const key = buildPermissionKey(PermissionResource.AUDIT_LOG, PermissionAction.CREATE);
    expect(key).toBe('auditLog:create');
    expect(ALL_PERMISSION_KEYS).not.toContain(key);
  });

  it('definePageKey 只是品牌化字串', () => {
    expect(definePageKey('ROLE')).toBe('ROLE');
  });

  it('evaluateAccess：EVERY 用 canEvery', () => {
    const rule: PagePermissionRule = {
      access: [PermissionKey['role:read']],
      match: PermissionMatch.EVERY,
    };
    expect(
      evaluateAccess(
        rule,
        () => true,
        () => false,
      ),
    ).toBe(true);
  });

  it('evaluateAccess：SOME 用 canSome', () => {
    const rule: PagePermissionRule = {
      access: [PermissionKey['role:read']],
      match: PermissionMatch.SOME,
    };
    expect(
      evaluateAccess(
        rule,
        () => false,
        () => true,
      ),
    ).toBe(true);
  });

  it('evaluateAccess：未知策略大聲失敗（不 default 成全開或全關）', () => {
    const rule = { access: [], match: 'weird' } as unknown as PagePermissionRule;
    expect(() =>
      evaluateAccess(
        rule,
        () => true,
        () => true,
      ),
    ).toThrow(/Unsupported permission match/);
  });
});

describe('isPermissionKey（字串收窄成權限鍵）', () => {
  it.each(ALL_PERMISSION_KEYS)('目錄中的鍵 %s → true', (key) => {
    expect(isPermissionKey(key)).toBe(true);
  });

  it.each([
    ['任意字串', 'hello'],
    ['資源名稱（技能樹的群組節點 id）', 'user'],
    ['大小寫不同', 'User:Read'],
    ['空字串', ''],
  ])('%s → false', (_, value) => {
    expect(isPermissionKey(value)).toBe(false);
  });
});
