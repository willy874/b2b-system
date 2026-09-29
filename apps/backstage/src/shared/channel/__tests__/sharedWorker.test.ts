import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChannel } from '../createChannel';
import type { Channel } from '../createChannel';
import { startChannelHub } from '../relays/sharedWorkerHub';
import type { SharedWorkerScopeLike } from '../relays/sharedWorkerHub';
import { sharedWorkerTransport } from '../transports/sharedWorker';

type Messages = { ping: { n: number } };

const opened: Channel<Messages>[] = [];
const ports: MessagePort[] = [];

/** 啟動 hub，回傳「開一個分頁連到它」的函式（以真的 MessageChannel 連線）。 */
function startHub() {
  let onConnect: Parameters<SharedWorkerScopeLike['addEventListener']>[1] | undefined;
  startChannelHub({
    addEventListener: (_type, listener) => {
      onConnect = listener;
    },
  });
  return () => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    onConnect?.({ ports: [port2] });
    const worker = { port: port1 } as unknown as SharedWorker;
    const channel = createChannel<Messages>('x', { transport: sharedWorkerTransport(worker) });
    opened.push(channel);
    return { channel, port: port1 };
  };
}

afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
  for (const port of ports.splice(0)) port.close();
});

describe('sharedWorkerTransport ＋ startChannelHub（經 SharedWorker 中繼）', () => {
  it('hub 把一個分頁的訊息轉給其他所有分頁', async () => {
    const connectTab = startHub();
    const [a, b, c] = [connectTab(), connectTab(), connectTab()];
    const onSelf = vi.fn();
    const onB = vi.fn();
    const onC = vi.fn();
    a.channel.on('ping', onSelf);
    b.channel.on('ping', onB);
    c.channel.on('ping', onC);

    a.channel.post('ping', { n: 1 });

    await vi.waitFor(() => {
      expect(onB).toHaveBeenCalledWith({ n: 1 });
      expect(onC).toHaveBeenCalledWith({ n: 1 });
    });
    expect(onSelf).not.toHaveBeenCalled();
  });

  it('分頁關閉（pagehide）後 hub 不再轉給它', async () => {
    const connectTab = startHub();
    const a = connectTab();
    const b = connectTab();
    const onB = vi.fn();
    b.channel.on('ping', onB);
    const receivedByA = vi.fn();
    a.port.addEventListener('message', receivedByA);

    // 兩個 transport 都註冊了 pagehide；只模擬 b 關閉：直接送 b 的 bye
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- MessagePort 沒有 targetOrigin
    b.port.postMessage({ tag: 'ge-channel-hub', type: 'bye' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    a.channel.post('ping', { n: 1 });
    const c = connectTab();
    c.channel.post('ping', { n: 2 });

    await vi.waitFor(() => expect(receivedByA).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onB).not.toHaveBeenCalled();
  });

  it('hub 不轉發非頻道外框的訊息', async () => {
    const connectTab = startHub();
    const a = connectTab();
    const b = connectTab();
    const receivedByB = vi.fn();
    b.port.addEventListener('message', receivedByB);

    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- MessagePort 沒有 targetOrigin
    a.port.postMessage({ hello: 'world' });
    a.channel.post('ping', { n: 1 });

    await vi.waitFor(() => expect(receivedByB).toHaveBeenCalledTimes(1));
  });
});
