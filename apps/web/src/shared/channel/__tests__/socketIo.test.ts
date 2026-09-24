import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChannel } from '../createChannel';
import type { Channel } from '../createChannel';
import { socketIoTransport } from '../transports/socketIo';
import type { RealtimeSocketLike } from '../transports/socketIo';

type Messages = { ping: { n: number } };

const RELAY = 'channel.relay';
/** 伺服器白名單內的頻道名稱（`createChannel` 會補上 `ge:` 前綴）。 */
const RELAYABLE = 'store:preference:test';

type Listener = (envelope: unknown) => void;

/** 只實作傳輸層用到的部分；伺服器依約定把 `channel.relay` 轉給同使用者的所有連線（含發送者）。 */
class FakeSocket {
  connected = true;
  server: FakeServer | undefined;
  readonly listeners = new Set<Listener>();
  readonly emit = vi.fn((event: string, envelope: unknown) => {
    if (event === RELAY) this.server?.relay(envelope);
    return this;
  });
  on(event: string, listener: Listener) {
    if (event === RELAY) this.listeners.add(listener);
    return this;
  }
  off(event: string, listener: Listener) {
    if (event === RELAY) this.listeners.delete(listener);
    return this;
  }
  receive(envelope: unknown): void {
    for (const listener of this.listeners) listener(envelope);
  }
}

class FakeServer {
  readonly sockets: FakeSocket[] = [];
  connect(): FakeSocket {
    const socket = new FakeSocket();
    socket.server = this;
    this.sockets.push(socket);
    return socket;
  }
  relay(envelope: unknown): void {
    // 經過網路的是 JSON：接收端拿到的是另一份物件
    const wire: unknown = JSON.parse(JSON.stringify(envelope));
    for (const socket of this.sockets) socket.receive(wire);
  }
}

const opened: Channel<Messages>[] = [];

function open(socket: FakeSocket, name = RELAYABLE): Channel<Messages> {
  const channel = createChannel<Messages>(name, {
    transport: socketIoTransport(socket as unknown as RealtimeSocketLike),
  });
  opened.push(channel);
  return channel;
}

afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
});

describe('socketIoTransport（docs/architecture/frontend/11-realtime.md §7）', () => {
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

  it('只把外框交給伺服器，由 createChannel 組好 channel / sender / id', () => {
    const socket = new FakeSocket();
    open(socket).post('ping', { n: 1 });

    expect(socket.emit).toHaveBeenCalledWith(
      RELAY,
      expect.objectContaining({
        tag: 'ge-channel',
        channel: 'ge:store:preference:test',
        type: 'ping',
        payload: { n: 1 },
      }),
    );
  });

  it('斷線時直接丟棄，不交給 Socket.io 緩衝到重連後補送', () => {
    const socket = new FakeSocket();
    socket.connected = false;
    const channel = open(socket);

    channel.post('ping', { n: 1 });
    socket.connected = true;

    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('不在伺服器白名單的頻道（例：session:*）不經過這條連線', () => {
    const socket = new FakeSocket();
    open(socket, 'session:main').post('ping', { n: 1 });

    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.listeners.size).toBe(0);
  });

  it('頻道 close() 只取消訂閱，連線本身不受影響', () => {
    const socket = new FakeSocket();
    const channel = open(socket);
    expect(socket.listeners.size).toBe(1);

    channel.close();

    expect(socket.listeners.size).toBe(0);
    expect(socket.connected).toBe(true);
  });
});
