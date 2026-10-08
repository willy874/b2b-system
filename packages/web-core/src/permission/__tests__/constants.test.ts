import { describe, expect, it, vi } from 'vitest';

import {
  buildPermissionKey,
  definePageKey,
  evaluateAccess,
  PermissionAction,
  PermissionMatch,
} from '../constants';
import type { PagePermissionRule } from '../constants';

describe('buildPermissionKey', () => {
  it('以「資源:動作」組出權限鍵', () => {
    expect(buildPermissionKey('role', PermissionAction.DELETE)).toBe('role:delete');
  });
});

describe('definePageKey', () => {
  it('回傳原字串（品牌化只在型別層）', () => {
    expect(definePageKey('ROLE')).toBe('ROLE');
  });
});

describe('evaluateAccess（docs/architecture/frontend/10-testing.md §6 權限）', () => {
  const access = ['role:read', 'user:read'];

  it('match 為 every 時交給 canEvery 判斷', () => {
    const canEvery = vi.fn(() => false);
    const canSome = vi.fn(() => true);
    const rule: PagePermissionRule = { access, match: PermissionMatch.EVERY };

    expect(evaluateAccess(rule, canEvery, canSome)).toBe(false);
    expect(canEvery).toHaveBeenCalledWith(access);
    expect(canSome).not.toHaveBeenCalled();
  });

  it('match 為 some 時交給 canSome 判斷', () => {
    const canEvery = vi.fn(() => false);
    const canSome = vi.fn(() => true);
    const rule: PagePermissionRule = { access, match: PermissionMatch.SOME };

    expect(evaluateAccess(rule, canEvery, canSome)).toBe(true);
    expect(canSome).toHaveBeenCalledWith(access);
    expect(canEvery).not.toHaveBeenCalled();
  });

  it('未知的 match 值 → 丟例外，不靜默全開或全關', () => {
    const rule = { access, match: 'any' } as unknown as PagePermissionRule;
    expect(() =>
      evaluateAccess(
        rule,
        () => true,
        () => true,
      ),
    ).toThrow('Unsupported permission match: any');
  });
});
