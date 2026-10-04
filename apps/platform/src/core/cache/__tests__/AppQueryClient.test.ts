import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChannelHub } from '@/test/fakeChannelHub';

import { AppQueryClient, createQueryInvalidateChannel } from '../AppQueryClient';
import type { InvalidationTarget } from '../resourceGraph';

vi.mock('@/core/realtime', () => ({ isRealtimeAvailable: () => false }));

const targets: InvalidationTarget[] = [
  { queryKey: ['role-detail', 'role-1'], action: 'remove' },
  { queryKey: ['role-list'], action: 'invalidate' },
];

const clients: AppQueryClient[] = [];

/** 每次呼叫代表一個分頁的 queryClient；`realtime` 決定推播是否可用。 */
function openTabs(count: number, { realtime = false } = {}) {
  const hub = createFakeChannelHub();
  const tabs = Array.from({ length: count }, () => {
    const client = new AppQueryClient({
      channel: createQueryInvalidateChannel({ transport: hub.transport() }),
      isRealtimeAvailable: () => realtime,
    });
    vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    vi.spyOn(client, 'removeQueries').mockImplementation(() => {});
    client.start();
    clients.push(client);
    return client;
  });
  return { tabs, hub };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.restoreAllMocks();
});

describe('AppQueryClient.broadcastInvalidation（docs/architecture/frontend/11-realtime.md §4.2）', () => {
  it('斷線（或推播停用）時本地失效，並經頻道讓其他分頁失效', async () => {
    const { tabs } = openTabs(2);
    const [a, b] = tabs as [AppQueryClient, AppQueryClient];

    a.broadcastInvalidation(targets);

    expect(a.removeQueries).toHaveBeenCalledWith({ queryKey: ['role-detail', 'role-1'] });
    expect(a.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['role-list'],
      refetchType: 'active',
    });
    await vi.waitFor(() =>
      expect(b.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['role-list'],
        refetchType: 'active',
      }),
    );
    expect(b.removeQueries).toHaveBeenCalledWith({ queryKey: ['role-detail', 'role-1'] });
  });

  it('推播可用時只本地失效，不廣播（其他分頁會經 leader 分頁收到）', () => {
    const { tabs, hub } = openTabs(2, { realtime: true });

    tabs[0]?.broadcastInvalidation(targets);

    expect(tabs[0]?.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(hub.sentOfType('invalidate')).toHaveLength(0);
  });

  it('收到的失效只在本分頁套用，不再轉送（避免迴圈）', async () => {
    const { tabs, hub } = openTabs(3);

    tabs[0]?.broadcastInvalidation(targets);

    await vi.waitFor(() => expect(tabs[2]?.invalidateQueries).toHaveBeenCalled());
    expect(hub.sentOfType('invalidate')).toHaveLength(1);
  });

  it('stop 之後不再套用其他分頁的失效', async () => {
    const { tabs } = openTabs(2);
    tabs[1]?.stop();

    tabs[0]?.broadcastInvalidation(targets);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tabs[1]?.invalidateQueries).not.toHaveBeenCalled();
  });
});

describe('AppQueryClient.applyInvalidation', () => {
  it('只在本分頁套用，不論連線狀態都不廣播', () => {
    const { tabs, hub } = openTabs(2);

    tabs[0]?.applyInvalidation(targets);

    expect(tabs[0]?.removeQueries).toHaveBeenCalledTimes(1);
    expect(tabs[0]?.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(hub.sentOfType('invalidate')).toHaveLength(0);
  });

  it('refetch: false（背景分頁）只標 stale、不重抓', () => {
    const { tabs } = openTabs(1);

    tabs[0]?.applyInvalidation(targets, { refetch: false });

    expect(tabs[0]?.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['role-list'],
      refetchType: 'none',
    });
  });
});

describe('AppQueryClient.revalidateAll', () => {
  it('整批失效；refetch: false 只標 stale', () => {
    const { tabs } = openTabs(1);

    tabs[0]?.revalidateAll({ refetch: false });

    expect(tabs[0]?.invalidateQueries).toHaveBeenCalledWith({ refetchType: 'none' });
  });
});
