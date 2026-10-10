import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { featureStore, resetFeatureStore } from '../store';
import { useFeatureReadiness } from '../useFeatureReadiness';

describe('useFeatureReadiness（docs/architecture/frontend/02-plugin-system.md §7）', () => {
  beforeEach(() => {
    resetFeatureStore();
  });

  it('只有已安裝的 feature 是 true；常駐（null）永遠是 true', () => {
    featureStore.setState({
      resolved: true,
      statuses: new Map([
        ['file', 'ready'],
        ['webhook', 'disabled'],
        ['group', 'installing'],
      ]),
    });
    const { result } = renderHook(() => useFeatureReadiness());
    expect(result.current('file')).toBe(true);
    expect(result.current('webhook')).toBe(false);
    expect(result.current('group')).toBe(false);
    expect(result.current('gallery')).toBe(false);
    expect(result.current(null)).toBe(true);
  });

  it('平台打開 feature 時跟著更新（回傳的函式換新）', () => {
    featureStore.setState({ resolved: true, statuses: new Map([['webhook', 'disabled']]) });
    const { result } = renderHook(() => useFeatureReadiness());
    const before = result.current;
    act(() => featureStore.setState({ statuses: new Map([['webhook', 'ready']]) }));
    expect(result.current('webhook')).toBe(true);
    expect(result.current).not.toBe(before);
  });
});
