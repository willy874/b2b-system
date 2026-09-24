import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChannelTransportFactory } from '@/shared/channel';

import { create } from '../create';
import { shareStore } from '../shareStore';

interface CounterStore {
  count: number;
  draft: string;
  setCount: (count: number) => void;
}

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
const stops: (() => void)[] = [];

function createCounter() {
  return create<CounterStore>((set) => ({
    count: 0,
    draft: '',
    setCount: (count) => set({ count }),
  }));
}

/**
 * 手動送達的傳輸層：訊息先排隊，`flush()` 才交給其他參與者。
 * 用來決定「誰先收到什麼」，讓同時修改、亂序送達的案例可以重現。
 */
function manualHub() {
  const listeners = new Set<(message: unknown) => void>();
  const queue: { message: unknown; from: (message: unknown) => void }[] = [];
  /** 送出過的訊息型別（依序），用來斷言「某種訊息從沒送出」。 */
  const sentTypes: string[] = [];
  const transport: ChannelTransportFactory = () => {
    let own: ((message: unknown) => void) | undefined;
    return {
      post(message) {
        sentTypes.push((message as { type: string }).type);
        if (own) queue.push({ message, from: own });
      },
      subscribe(listener) {
        own = listener;
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close() {},
    };
  };
  const flush = () => {
    while (queue.length) {
      const { message, from } = queue.shift()!;
      for (const listener of listeners) if (listener !== from) listener(message);
    }
  };
  return { transport, flush, queue, sentTypes };
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

describe.runIf(hasBroadcastChannel)('shareStore（跨分頁單一狀態，BroadcastChannel）', () => {
  /** 每次呼叫代表一個分頁裡的同一個 store。 */
  function openTab() {
    const store = createCounter();
    stops.push(shareStore(store, 'test-counter', ['count']));
    return store;
  }

  it('一個分頁改了，其他分頁跟著更新', async () => {
    const [a, b, c] = [openTab(), openTab(), openTab()];

    a.getState().setCount(3);

    await vi.waitFor(() => {
      expect(b.getState().count).toBe(3);
      expect(c.getState().count).toBe(3);
    });
  });

  it('新開的分頁向既有分頁拿到目前的狀態（syncStore 做不到）', async () => {
    const a = openTab();
    a.getState().setCount(7);

    const late = openTab();

    await vi.waitFor(() => expect(late.getState().count).toBe(7));
  });

  it('不在 keys 裡的欄位不共享', async () => {
    const [a, b] = [openTab(), openTab()];

    a.setState({ draft: 'local only', count: 1 });

    await vi.waitFor(() => expect(b.getState().count).toBe(1));
    expect(b.getState().draft).toBe('');
  });

  it('停止共享後不再收發', async () => {
    const [a, b, c] = [openTab(), openTab(), openTab()];
    stops[1]?.();

    a.getState().setCount(5);

    await vi.waitFor(() => expect(c.getState().count).toBe(5));
    expect(b.getState().count).toBe(0);
  });
});

describe('shareStore（版本與衝突，手動送達）', () => {
  function openTab(hub: ReturnType<typeof manualHub>) {
    const store = createCounter();
    stops.push(shareStore(store, 'test-counter', ['count'], { transport: hub.transport }));
    return store;
  }

  it('沒有人改過時，新分頁保持初始值（初始值不回覆快照）', () => {
    const hub = manualHub();
    const a = openTab(hub);
    a.setState({ draft: 'not shared' });
    hub.flush();

    openTab(hub);
    hub.flush();

    // 只有兩次加入時的快照請求；沒人改過，誰都不回覆（否則會依寫入者 id 隨機蓋掉別人的初始值）
    expect(hub.sentTypes).toEqual(['snapshot-request', 'snapshot-request']);
  });

  it('兩個分頁同時修改（同版本）→ 最後收斂到同一個值', () => {
    const hub = manualHub();
    const [a, b] = [openTab(hub), openTab(hub)];
    hub.flush(); // 加入時的快照請求

    // 兩邊都在收到對方之前修改：都是版本 1
    a.getState().setCount(1);
    b.getState().setCount(2);
    hub.flush();

    expect(a.getState().count).toBe(b.getState().count);
    expect([1, 2]).toContain(a.getState().count);
  });

  it('較舊的版本晚到時被略過', () => {
    const hub = manualHub();
    const [a, b] = [openTab(hub), openTab(hub)];
    hub.flush();

    a.getState().setCount(1); // 版本 1
    a.getState().setCount(2); // 版本 2
    // 模擬亂序：版本 2 先到、版本 1 後到
    hub.queue.reverse();
    hub.flush();

    expect(b.getState().count).toBe(2);
  });

  it('收到遠端狀態後的本地修改一定比它新，不會被舊訊息蓋回去', () => {
    const hub = manualHub();
    const [a, b] = [openTab(hub), openTab(hub)];
    hub.flush();

    a.getState().setCount(1);
    hub.flush(); // b 收到版本 1

    b.getState().setCount(9); // b 以版本 2 修改
    hub.flush();

    expect(a.getState().count).toBe(9);
    expect(b.getState().count).toBe(9);
  });

  it('收到的更新不再廣播回去（不會迴圈）', () => {
    const hub = manualHub();
    const [a] = [openTab(hub), openTab(hub)];
    hub.flush();

    a.getState().setCount(1);
    hub.flush();

    expect(hub.queue).toHaveLength(0);
  });
});
