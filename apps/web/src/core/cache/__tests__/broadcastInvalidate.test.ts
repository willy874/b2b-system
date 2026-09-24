import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isRealtimeAvailable } from '@/core/realtime';

import {
  applyInvalidation,
  broadcastInvalidate,
  initInvalidateChannel,
} from '../broadcastInvalidate';
import { queryClient } from '../queryClient';
import type { InvalidationTarget } from '../resourceGraph';

const post = vi.fn();

vi.mock('@/shared/channel', () => ({
  createChannel: () => ({ post, on: vi.fn(), close: vi.fn() }),
}));

vi.mock('@/core/realtime', () => ({ isRealtimeAvailable: vi.fn(() => false) }));

const targets: InvalidationTarget[] = [
  { queryKey: ['role-detail', 'role-1'], action: 'remove' },
  { queryKey: ['role-list'], action: 'invalidate' },
];

let close: () => void;

beforeEach(() => {
  close = initInvalidateChannel();
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  vi.spyOn(queryClient, 'removeQueries').mockImplementation(() => {});
});

afterEach(() => {
  close();
  post.mockClear();
  vi.mocked(isRealtimeAvailable).mockReturnValue(false);
  vi.restoreAllMocks();
});

describe('broadcastInvalidate（docs/architecture/frontend/11-realtime.md §4.2）', () => {
  it('斷線（或推播停用）時本地失效並經本機頻道廣播', () => {
    broadcastInvalidate(targets);

    expect(queryClient.removeQueries).toHaveBeenCalledWith({ queryKey: ['role-detail', 'role-1'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['role-list'],
      refetchType: 'active',
    });
    expect(post).toHaveBeenCalledWith('invalidate', targets);
  });

  it('推播可用時只本地失效，不廣播（其他分頁會經 leader 分頁收到）', () => {
    vi.mocked(isRealtimeAvailable).mockReturnValue(true);

    broadcastInvalidate(targets);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['role-list'],
      refetchType: 'active',
    });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('applyInvalidation', () => {
  it('只在本分頁套用，不論連線狀態都不廣播', () => {
    applyInvalidation(targets);

    expect(queryClient.removeQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('refetch: false（背景分頁）只標 stale、不重抓', () => {
    applyInvalidation(targets, { refetch: false });

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['role-list'],
      refetchType: 'none',
    });
  });
});
