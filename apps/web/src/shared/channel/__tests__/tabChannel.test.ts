import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTabChannel } from '../tabChannel';
import type { TabChannel } from '../tabChannel';

type Messages = { ping: { n: number }; bye: { reason: string } };

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
const opened: TabChannel<Messages>[] = [];

/** 每個實例代表一個分頁。 */
function openTab(name = 'test'): TabChannel<Messages> {
  const channel = createTabChannel<Messages>(name);
  opened.push(channel);
  return channel;
}

afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
});

describe.runIf(hasBroadcastChannel)('createTabChannel（型別化跨分頁頻道）', () => {
  it('依 type 分派給對應的 listener', async () => {
    const [a, b] = [openTab(), openTab()];
    const onPing = vi.fn();
    const onBye = vi.fn();
    b.on('ping', onPing);
    b.on('bye', onBye);

    a.post('ping', { n: 1 });

    await vi.waitFor(() => expect(onPing).toHaveBeenCalledWith({ n: 1 }));
    expect(onBye).not.toHaveBeenCalled();
  });

  it('自己送出的訊息自己收不到', async () => {
    const [a, b] = [openTab(), openTab()];
    const onSelf = vi.fn();
    const onPeer = vi.fn();
    a.on('ping', onSelf);
    b.on('ping', onPeer);

    a.post('ping', { n: 1 });

    await vi.waitFor(() => expect(onPeer).toHaveBeenCalled());
    expect(onSelf).not.toHaveBeenCalled();
  });

  it('不同名稱的頻道彼此隔離', async () => {
    const a = openTab('one');
    const sameName = openTab('one');
    const otherName = openTab('two');
    const onSame = vi.fn();
    const onOther = vi.fn();
    sameName.on('ping', onSame);
    otherName.on('ping', onOther);

    a.post('ping', { n: 1 });

    await vi.waitFor(() => expect(onSame).toHaveBeenCalled());
    expect(onOther).not.toHaveBeenCalled();
  });

  it('取消訂閱與 close 之後不再收到，close 後 post 也不會拋出', async () => {
    const [a, b, c] = [openTab(), openTab(), openTab()];
    const onB = vi.fn();
    const onC = vi.fn();
    const off = b.on('ping', onB);
    c.on('ping', onC);
    off();

    a.post('ping', { n: 1 });
    await vi.waitFor(() => expect(onC).toHaveBeenCalledTimes(1));
    expect(onB).not.toHaveBeenCalled();

    c.close();
    a.post('ping', { n: 2 });
    a.close();
    expect(() => a.post('ping', { n: 3 })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onC).toHaveBeenCalledTimes(1);
  });

  it('收到格式不符的訊息時略過（其他版本的分頁送來的）', async () => {
    const b = openTab();
    const onPing = vi.fn();
    b.on('ping', onPing);
    const raw = new BroadcastChannel('ge:test');

    // oxlint-disable unicorn/require-post-message-target-origin -- BroadcastChannel 沒有 targetOrigin
    raw.postMessage('not-an-envelope');
    raw.postMessage({ type: 'unknown', payload: 1 });
    raw.postMessage({ type: 'ping', payload: { n: 9 } });
    // oxlint-enable unicorn/require-post-message-target-origin
    raw.close();

    await vi.waitFor(() => expect(onPing).toHaveBeenCalledWith({ n: 9 }));
    expect(onPing).toHaveBeenCalledTimes(1);
  });
});
