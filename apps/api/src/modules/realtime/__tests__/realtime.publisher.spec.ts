import { describe, expect, it, vi } from 'vitest';

import { SocketIoRealtimePublisher } from '../realtime.publisher';
import type { RealtimeServer } from '../realtime.types';

function setup(openRooms: Record<string, number> = {}) {
  const emit = vi.fn();
  const operator = {
    socketsLeave: vi.fn(),
    socketsJoin: vi.fn(),
    disconnectSockets: vi.fn(),
  };
  const server = {
    sockets: {
      adapter: { rooms: new Map(Object.entries(openRooms).map(([r, n]) => [r, { size: n }])) },
    },
    to: vi.fn(() => ({ emit })),
    in: vi.fn(() => operator),
  };
  const publisher = new SocketIoRealtimePublisher();
  publisher.attach(server as unknown as RealtimeServer);
  return { publisher, server, emit, operator };
}

describe('SocketIoRealtimePublisher（docs/architecture/backend/08-realtime.md §2）', () => {
  it('emit 推給 room 的聯集；單一 room 也包成陣列', () => {
    const { publisher, server, emit } = setup();

    publisher.emit(['perm:role:read', 'user:u1'], 'resource.changed', { changes: [] });
    publisher.emit('user:u2', 'session.expired');

    expect(server.to).toHaveBeenNthCalledWith(1, ['perm:role:read', 'user:u1']);
    expect(server.to).toHaveBeenNthCalledWith(2, ['user:u2']);
    expect(emit).toHaveBeenNthCalledWith(1, 'resource.changed', { changes: [] });
    expect(emit).toHaveBeenNthCalledWith(2, 'session.expired');
  });

  it('沒有 room 時不推（Socket.io 的 to([]) 會廣播給所有連線）', () => {
    const { publisher, server } = setup();
    publisher.emit([], 'resource.changed', { changes: [] });
    expect(server.to).not.toHaveBeenCalled();
  });

  it('countConnections 讀本節點 room 的大小；沒有這個 room 是 0', () => {
    const { publisher } = setup({ 'user:u1': 2 });
    expect(publisher.countConnections('user:u1')).toBe(2);
    expect(publisher.countConnections('user:u2')).toBe(0);
  });

  it('moveRooms 先離開再加入；disconnect 連底層連線一起關', () => {
    const { publisher, server, operator } = setup();

    publisher.moveRooms('user:u1', ['perm:a', 'perm:b'], ['perm:a']);
    publisher.disconnect('user:u1');

    expect(server.in).toHaveBeenCalledWith('user:u1');
    expect(operator.socketsLeave).toHaveBeenCalledWith(['perm:a', 'perm:b']);
    expect(operator.socketsJoin).toHaveBeenCalledWith(['perm:a']);
    expect(operator.socketsLeave.mock.invocationCallOrder[0]).toBeLessThan(
      operator.socketsJoin.mock.invocationCallOrder[0] as number,
    );
    expect(operator.disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('gateway 尚未交出伺服器（啟動中）時所有操作都是空操作', () => {
    const publisher = new SocketIoRealtimePublisher();
    expect(() => {
      publisher.emit('user:u1', 'session.expired');
      publisher.moveRooms('user:u1', [], []);
      publisher.disconnect('user:u1');
    }).not.toThrow();
    expect(publisher.countConnections('user:u1')).toBe(0);
  });
});
