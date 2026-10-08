import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWatch } from '../useWatch';

const api = vi.hoisted(() => ({ state: vi.fn(), watch: vi.fn(), unwatch: vi.fn() }));
vi.mock('@/apis/watch/get-watch-state/fetcher', () => ({ fetchWatchStateQuery: api.state }));
vi.mock('@/apis/watch/watch-resource/fetcher', () => ({ fetchWatchMutation: api.watch }));
vi.mock('@/apis/watch/unwatch-resource/fetcher', () => ({ fetchUnwatchMutation: api.unwatch }));

const target = { resourceType: 'user', resourceId: 'u1' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  api.watch.mockResolvedValue({ watching: true, watcherCount: 1 });
  api.unwatch.mockResolvedValue({ watching: false, watcherCount: 0 });
});

describe('useWatch（docs/architecture/backend/24-comment.md §3.2）', () => {
  it('沒有關注 → toggle 關注', async () => {
    api.state.mockResolvedValue({ watching: false, watcherCount: 0 });
    const { result } = renderHook(() => useWatch(target), { wrapper: AllProviders });
    await waitFor(() => expect(result.current.state.data).toBeDefined());
    act(() => result.current.toggle());
    await waitFor(() => expect(api.watch.mock.calls[0]?.[0]).toMatchObject({ params: target }));
    expect(api.unwatch).not.toHaveBeenCalled();
  });

  it('關注中 → toggle 取消關注', async () => {
    api.state.mockResolvedValue({ watching: true, watcherCount: 3 });
    const { result } = renderHook(() => useWatch(target), { wrapper: AllProviders });
    await waitFor(() => expect(result.current.state.data?.watching).toBe(true));
    act(() => result.current.toggle());
    await waitFor(() => expect(api.unwatch.mock.calls[0]?.[0]).toMatchObject({ params: target }));
  });
});
