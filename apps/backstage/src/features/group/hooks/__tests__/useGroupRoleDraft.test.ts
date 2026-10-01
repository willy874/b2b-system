import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useGroupRoleDraft } from '../useGroupRoleDraft';

describe('useGroupRoleDraft（群組持有角色的選擇草稿）', () => {
  it('沒有改動時跟著伺服器的角色走，不算 dirty', () => {
    const { result, rerender } = renderHook(({ current }) => useGroupRoleDraft(current), {
      initialProps: { current: ['r1'] },
    });
    expect(result.current.selected).toEqual(['r1']);
    expect(result.current.isDirty).toBe(false);
    // 推播讓資料重抓：草稿跟著更新
    rerender({ current: ['r1', 'r2'] });
    expect(result.current.selected).toEqual(['r1', 'r2']);
  });

  it('選擇之後送差異：只帶增加與移除的角色', () => {
    const { result } = renderHook(() => useGroupRoleDraft(['r1', 'r2']));
    act(() => result.current.select(['r2', 'r3']));
    expect(result.current.isDirty).toBe(true);
    expect(result.current.diff).toEqual({ add: ['r3'], remove: ['r1'] });
  });

  it('改動之後保留選擇；discard 回到伺服器的角色', () => {
    const { result, rerender } = renderHook(({ current }) => useGroupRoleDraft(current), {
      initialProps: { current: ['r1'] },
    });
    act(() => result.current.select(['r1', 'r2']));
    rerender({ current: ['r1', 'r9'] });
    expect(result.current.selected.toSorted()).toEqual(['r1', 'r2']);
    act(() => result.current.discard());
    expect(result.current.selected.toSorted()).toEqual(['r1', 'r9']);
  });
});
