import { describe, expect, it, vi } from 'vitest';

import { createRegistry } from '../createRegistry';
import { collectRegistrations } from '../scope';

describe('createRegistry（docs/architecture/frontend/02-plugin-system.md §9.2 D4）', () => {
  it('重複登記同一個 key 丟例外', () => {
    const registry = createRegistry<string, number>('Thing');
    registry.register('a', 1);

    expect(() => registry.register('a', 2)).toThrow('Thing already registered: a');
  });

  it('反註冊後可以再登記同一個 key', () => {
    const registry = createRegistry<string, number>('Thing');
    const dispose = registry.register('a', 1);

    dispose();
    expect(registry.has('a')).toBe(false);
    expect(() => registry.register('a', 2)).not.toThrow();
    expect(registry.get('a')).toBe(2);
  });

  it('舊的反註冊函式不會刪掉後來重新登記的值', () => {
    const registry = createRegistry<string, number>('Thing');
    const disposeOld = registry.register('a', 1);
    disposeOld();
    registry.register('a', 2);

    disposeOld();
    expect(registry.get('a')).toBe(2);
  });

  it('登記與反註冊都通知訂閱者，且每次換成新的 Map', () => {
    const registry = createRegistry<string, number>('Thing');
    const listener = vi.fn();
    registry.store.subscribe(listener);
    const before = registry.store.getState().entries;

    const dispose = registry.register('a', 1);
    const afterRegister = registry.store.getState().entries;
    dispose();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(afterRegister).not.toBe(before);
    expect(registry.keys()).toEqual([]);
  });
});

describe('collectRegistrations', () => {
  it('收集範圍內的登記，一次撤回', () => {
    const pages = createRegistry<string, number>('Page');
    const tools = createRegistry<string, number>('Tool');
    pages.register('resident', 0);

    const { dispose } = collectRegistrations(() => {
      pages.register('a', 1);
      tools.register('b', 2);
    });
    dispose();

    expect(pages.keys()).toEqual(['resident']);
    expect(tools.keys()).toEqual([]);
  });

  it('範圍內丟例外時先撤回已登記的，再把例外往外拋', () => {
    const registry = createRegistry<string, number>('Thing');

    expect(() =>
      collectRegistrations(() => {
        registry.register('a', 1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(registry.keys()).toEqual([]);
  });

  it('巢狀時內層的登記也算進外層', () => {
    const registry = createRegistry<string, number>('Thing');

    const outer = collectRegistrations(() => {
      collectRegistrations(() => registry.register('inner', 1));
      registry.register('outer', 2);
    });
    outer.dispose();

    expect(registry.keys()).toEqual([]);
  });

  it('範圍之外的登記不被收集', () => {
    const registry = createRegistry<string, number>('Thing');
    const { dispose } = collectRegistrations(() => undefined);
    registry.register('resident', 1);

    dispose();
    expect(registry.keys()).toEqual(['resident']);
  });
});
