import { createFakeChannelHub } from '@b2b-system/web-shared/testing';
import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppQueryClient, createQueryInvalidateChannel } from '../AppQueryClient';
import type { InvalidationTarget } from '../resourceGraph';

vi.mock('../../realtime', () => ({ isRealtimeAvailable: () => false }));

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
    expect(a.invalidateQueries).toHaveBeenCalledWith(
      { queryKey: ['role-list'], refetchType: 'active' },
      { cancelRefetch: false },
    );
    await vi.waitFor(() =>
      expect(b.invalidateQueries).toHaveBeenCalledWith(
        { queryKey: ['role-list'], refetchType: 'active' },
        { cancelRefetch: false },
      ),
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

    expect(tabs[0]?.invalidateQueries).toHaveBeenCalledWith(
      { queryKey: ['role-list'], refetchType: 'none' },
      { cancelRefetch: false },
    );
  });
});

/** 真的 QueryClient ＋ 一個有 observer（active）的 query；每次 queryFn 都等測試放行 */
function activeQuery() {
  const client = new AppQueryClient({
    channel: createQueryInvalidateChannel({ transport: createFakeChannelHub().transport() }),
    isRealtimeAvailable: () => false,
  });
  clients.push(client);
  const calls: Array<{ signal: AbortSignal; resolve: (value: number) => void }> = [];
  const observer = new QueryObserver(client, {
    queryKey: ['role-list'],
    queryFn: ({ signal }) =>
      new Promise<number>((resolve) => {
        calls.push({ signal, resolve });
      }),
  });
  const unsubscribe = observer.subscribe(() => undefined);
  return { client, calls, observer, unsubscribe };
}

describe('AppQueryClient.applyInvalidation：進行中的重抓（docs/architecture/frontend/05-data-layer.md §6.3）', () => {
  it('不取消進行中的請求；連續失效只在它回來後再重抓一次', async () => {
    const { client, calls, observer, unsubscribe } = activeQuery();
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    // 批次與推播：同一個請求進行中又失效了三次
    client.applyInvalidation([{ queryKey: ['role-list'], action: 'invalidate' }]);
    client.applyInvalidation([{ queryKey: ['role-list'], action: 'invalidate' }]);
    client.applyInvalidation([{ queryKey: ['role-list'], action: 'invalidate' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal.aborted).toBe(false);

    // 第一個請求可能早於這幾次寫入：回來後再重抓一次，畫面最後顯示的是之後的結果
    calls[0]?.resolve(1);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1]?.resolve(2);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(2));
    expect(calls).toHaveLength(2);
    unsubscribe();
  });

  it('沒有進行中的請求時照常立刻重抓', async () => {
    const { client, calls, observer, unsubscribe } = activeQuery();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]?.resolve(1);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(1));

    client.applyInvalidation([{ queryKey: ['role-list'], action: 'invalidate' }]);

    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1]?.resolve(2);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(2));
    unsubscribe();
  });
});

describe('AppQueryClient.revalidateAll', () => {
  it('整批失效；refetch: false 只標 stale', () => {
    const { tabs } = openTabs(1);

    tabs[0]?.revalidateAll({ refetch: false });

    expect(tabs[0]?.invalidateQueries).toHaveBeenCalledWith({ refetchType: 'none' });
  });
});
