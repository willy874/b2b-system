import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { featureStore, resetFeatureStore } from '../store';
import { useFlag } from '../useFlag';

describe('useFlag（docs/architecture/05-tenancy.md §11.2 D9）', () => {
  beforeEach(() => {
    resetFeatureStore();
  });

  it('profile 還沒到 → 關', () => {
    const { result } = renderHook(() => useFlag('levelEditor.v2'));
    expect(result.current).toBe(false);
  });

  it('跟著 store 的 flags 變化', () => {
    const { result } = renderHook(() => useFlag('levelEditor.v2'));

    act(() => featureStore.setState({ flags: new Set(['levelEditor.v2']) }));
    expect(result.current).toBe(true);

    act(() => featureStore.setState({ flags: new Set() }));
    expect(result.current).toBe(false);
  });
});
