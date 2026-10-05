import type { ChannelEnvelopeWire } from '@b2b-system/realtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChannel } from '../createChannel';
import type { Channel } from '../createChannel';
import { serverRelayTransport } from '../transports/serverRelay';
import type { ServerRelayLink } from '../transports/serverRelay';

type Messages = { ping: { n: number } };

/** 伺服器白名單內的頻道名稱（`createChannel` 會補上 `ge:` 前綴）。 */
const RELAYABLE = 'store:preference:test';

type Listener = (envelope: ChannelEnvelopeWire) => void;

/** 伺服器依約定把中繼的外框轉給同使用者的所有連線（含發送者）。 */
class FakeLink implements ServerRelayLink {
  connected = true;
  server: FakeServer | undefined;
  readonly listeners = new Set<Listener>();
  readonly send = vi.fn((envelope: ChannelEnvelopeWire) => this.server?.relay(envelope));
  isConnected(): boolean {
    return this.connected;
  }
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  receive(envelope: ChannelEnvelopeWire): void {
    for (const listener of this.listeners) listener(envelope);
  }
}

class FakeServer {
  readonly links: FakeLink[] = [];
  connect(): FakeLink {
    const link = new FakeLink();
    link.server = this;
    this.links.push(link);
    return link;
  }
  relay(envelope: ChannelEnvelopeWire): void {
    // 經過網路的是 JSON：接收端拿到的是另一份物件
    const wire = JSON.parse(JSON.stringify(envelope)) as ChannelEnvelopeWire;
    for (const link of this.links) link.receive(wire);
  }
}

const opened: Channel<Messages>[] = [];

function open(link: FakeLink, name = RELAYABLE): Channel<Messages> {
  const channel = createChannel<Messages>(name, { transport: serverRelayTransport(link) });
  opened.push(channel);
  return channel;
}

afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
});

describe('serverRelayTransport（docs/architecture/frontend/11-realtime.md §7）', () => {
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
    const link = new FakeLink();
    open(link).post('ping', { n: 1 });

    expect(link.send).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'ge-channel',
        channel: 'ge:store:preference:test',
        type: 'ping',
        payload: { n: 1 },
      }),
    );
  });

  it('斷線時直接丟棄，不交給傳輸層緩衝到重連後補送', () => {
    const link = new FakeLink();
    link.connected = false;
    const channel = open(link);

    channel.post('ping', { n: 1 });
    link.connected = true;

    expect(link.send).not.toHaveBeenCalled();
  });

  it('不在伺服器白名單的頻道（例：session:*）不經過這條連線', () => {
    const link = new FakeLink();
    open(link, 'session:main').post('ping', { n: 1 });

    expect(link.send).not.toHaveBeenCalled();
    expect(link.listeners.size).toBe(0);
  });

  it('頻道 close() 只取消訂閱，連線本身不受影響', () => {
    const link = new FakeLink();
    const channel = open(link);
    expect(link.listeners.size).toBe(1);

    channel.close();

    expect(link.listeners.size).toBe(0);
    expect(link.connected).toBe(true);
  });
});
