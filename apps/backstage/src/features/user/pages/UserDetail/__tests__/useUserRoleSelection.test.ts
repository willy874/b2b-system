import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { User } from '@/shared/api-sdk';

import { useUserRoleSelection } from '../useUserRoleSelection';

function rolesOf(...ids: string[]): User['roles'] {
  return ids.map((id) => ({ id, slug: id, name: id, isSystem: false }));
}

describe('useUserRoleSelection（docs/issues/03-edge-cases.md EDGE-11）', () => {
  it('沒動過：跟著伺服器的角色走，不是 dirty', () => {
    const { result, rerender } = renderHook(({ roles }) => useUserRoleSelection(roles), {
      initialProps: { roles: rolesOf('member') },
    });
    expect([...result.current.selectedRoleIds]).toEqual(['member']);
    expect(result.current.isDirty).toBe(false);

    rerender({ roles: rolesOf('member', 'auditor') });
    expect([...result.current.selectedRoleIds]).toEqual(['member', 'auditor']);
    expect(result.current.isStale).toBe(false);
  });

  it('勾選後是 dirty；送出時帶上草稿所依據的角色', () => {
    const { result } = renderHook(() => useUserRoleSelection(rolesOf('member')));
    act(() => result.current.toggleRole('auditor', true));
    expect(result.current.isDirty).toBe(true);
    expect([...result.current.selectedRoleIds]).toEqual(['member', 'auditor']);
    expect(result.current.expectedRoleIds).toEqual(['member']);
  });

  it('有草稿時伺服器的角色被別人改了 → isStale，草稿不被默默覆蓋也不默默送出', () => {
    const { result, rerender } = renderHook(({ roles }) => useUserRoleSelection(roles), {
      initialProps: { roles: rolesOf('member') },
    });
    act(() => result.current.toggleRole('auditor', true));

    // 推播更新：B 把角色改成 admin
    rerender({ roles: rolesOf('admin') });
    expect(result.current.isStale).toBe(true);
    expect([...result.current.selectedRoleIds]).toEqual(['member', 'auditor']);
    // 送出時仍以舊的角色為基礎 → 後端回 409，不會蓋掉 B 的變更
    expect(result.current.expectedRoleIds).toEqual(['member']);
  });

  it('丟掉草稿 → 改用伺服器上最新的角色', () => {
    const { result, rerender } = renderHook(({ roles }) => useUserRoleSelection(roles), {
      initialProps: { roles: rolesOf('member') },
    });
    act(() => result.current.toggleRole('auditor', true));
    rerender({ roles: rolesOf('admin') });

    act(() => result.current.discardDraft());
    expect(result.current.isStale).toBe(false);
    expect(result.current.isDirty).toBe(false);
    expect([...result.current.selectedRoleIds]).toEqual(['admin']);
    expect(result.current.expectedRoleIds).toEqual(['admin']);
  });
});
