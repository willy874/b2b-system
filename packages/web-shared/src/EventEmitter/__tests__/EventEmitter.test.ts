import { describe, expect, it, vi } from 'vitest';

import { EventEmitter } from '..';

type Events = {
  saved: (id: string, version: number) => void;
  closed: () => void;
};

describe('EventEmitter（型別安全的事件匯流排）', () => {
  it('emit 把參數交給所有 listener', () => {
    const emitter = new EventEmitter<Events>();
    const first = vi.fn();
    const second = vi.fn();
    emitter.on('saved', first);
    emitter.on('saved', second);

    emitter.emit('saved', 'a', 2);

    expect(first).toHaveBeenCalledWith('a', 2);
    expect(second).toHaveBeenCalledWith('a', 2);
  });

  it('沒有 listener 的事件 emit 不會出錯', () => {
    const emitter = new EventEmitter<Events>();
    expect(() => emitter.emit('closed')).not.toThrow();
  });

  it('on 回傳的函式與 off 都能取消訂閱', () => {
    const emitter = new EventEmitter<Events>();
    const viaReturn = vi.fn();
    const viaOff = vi.fn();
    const unsubscribe = emitter.on('closed', viaReturn);
    emitter.on('closed', viaOff);

    unsubscribe();
    emitter.off('closed', viaOff);
    emitter.emit('closed');

    expect(viaReturn).not.toHaveBeenCalled();
    expect(viaOff).not.toHaveBeenCalled();
  });

  it('once 只收到第一次', () => {
    const emitter = new EventEmitter<Events>();
    const listener = vi.fn();
    emitter.once('saved', listener);

    emitter.emit('saved', 'a', 1);
    emitter.emit('saved', 'b', 2);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('a', 1);
  });

  it('once 在觸發前取消就不會收到', () => {
    const emitter = new EventEmitter<Events>();
    const listener = vi.fn();
    const off = emitter.once('closed', listener);

    off();
    emitter.emit('closed');

    expect(listener).not.toHaveBeenCalled();
  });

  it('listener 在處理中取消其他 listener，這一輪仍會通知到（以 emit 當下的名單為準）', () => {
    const emitter = new EventEmitter<Events>();
    const later = vi.fn();
    emitter.on('closed', () => emitter.off('closed', later));
    emitter.on('closed', later);

    emitter.emit('closed');
    emitter.emit('closed');

    expect(later).toHaveBeenCalledTimes(1);
  });

  it('clear 移除所有事件的 listener', () => {
    const emitter = new EventEmitter<Events>();
    const saved = vi.fn();
    const closed = vi.fn();
    emitter.on('saved', saved);
    emitter.on('closed', closed);

    emitter.clear();
    emitter.emit('saved', 'a', 1);
    emitter.emit('closed');

    expect(saved).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });
});
