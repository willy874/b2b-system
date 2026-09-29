import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChannel } from '../createChannel';
import type { Channel } from '../createChannel';
import { webSocketTransport } from '../transports/webSocket';

type Messages = { ping: { n: number } };

class FakeSocket extends EventTarget {
  readyState: number = WebSocket.OPEN;
  readonly send = vi.fn((frame: string) => this.server?.relay(frame));
  server: FakeServer | undefined;
}

/** 依伺服器端約定：把每個 frame 轉給所有連線（包含發送者）。 */
class FakeServer {
  readonly sockets: FakeSocket[] = [];
  connect(socket = new FakeSocket()): FakeSocket {
    socket.server = this;
    this.sockets.push(socket);
    return socket;
  }
  relay(frame: string): void {
    for (const socket of this.sockets)
      socket.dispatchEvent(new MessageEvent('message', { data: frame }));
  }
}

const opened: Channel<Messages>[] = [];

function open(socket: FakeSocket, name = 'x'): Channel<Messages> {
  const channel = createChannel<Messages>(name, {
    transport: webSocketTransport(socket as unknown as WebSocket),
  });
  opened.push(channel);
  return channel;
}

afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
});

describe('webSocketTransport（經伺服器中繼）', () => {
  it('經伺服器轉給其他連線，轉回發送者的那份被略過', () => {
    const server = new FakeServer();
    const [a, b] = [open(server.connect()), open(server.connect())];
    const onSelf = vi.fn();
    const onPeer = vi.fn();
    a.on('ping', onSelf);
    b.on('ping', onPeer);

    a.post('ping', { n: 1 });

    expect(onPeer).toHaveBeenCalledWith({ n: 1 });
    expect(onSelf).not.toHaveBeenCalled();
  });

  it('多個頻道共用同一條連線，依名稱分流', () => {
    const server = new FakeServer();
    const socketA = server.connect();
    const socketB = server.connect();
    const aOne = open(socketA, 'one');
    const bOne = open(socketB, 'one');
    const bTwo = open(socketB, 'two');
    const onOne = vi.fn();
    const onTwo = vi.fn();
    bOne.on('ping', onOne);
    bTwo.on('ping', onTwo);

    aOne.post('ping', { n: 1 });

    expect(onOne).toHaveBeenCalledTimes(1);
    expect(onTwo).not.toHaveBeenCalled();
  });

  it('連線中送出的訊息排隊，open 後依序送出；已關閉時丟棄', () => {
    const socket = new FakeSocket();
    socket.readyState = WebSocket.CONNECTING;
    const channel = open(socket);

    channel.post('ping', { n: 1 });
    channel.post('ping', { n: 2 });
    expect(socket.send).not.toHaveBeenCalled();

    socket.readyState = WebSocket.OPEN;
    socket.dispatchEvent(new Event('open'));
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(socket.send.mock.calls[0]?.[0] ?? '')).toMatchObject({ payload: { n: 1 } });

    socket.readyState = WebSocket.CLOSED;
    channel.post('ping', { n: 3 });
    expect(socket.send).toHaveBeenCalledTimes(2);
  });

  it('同一條連線上的非 JSON frame 略過，不拋例外', () => {
    const socket = new FakeSocket();
    const onPing = vi.fn();
    open(socket).on('ping', onPing);

    expect(() => socket.dispatchEvent(new MessageEvent('message', { data: 'pong' }))).not.toThrow();
    expect(onPing).not.toHaveBeenCalled();
  });
});
