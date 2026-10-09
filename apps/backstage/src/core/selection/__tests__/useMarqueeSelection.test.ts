import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Rect } from '../geometry';
import { MARQUEE_ITEM_SELECTOR, useMarqueeSelection } from '../useMarqueeSelection';
import type { UseMarqueeSelectionOptions } from '../useMarqueeSelection';

let frames: FrameRequestCallback[];

function createScrollElement() {
  const element = document.createElement('div');
  const item = document.createElement('div');
  item.setAttribute('data-marquee-item', '');
  const custom = document.createElement('div');
  custom.setAttribute('data-photo', '');
  element.append(item, custom);
  document.body.append(element);
  let scrollTop = 0;
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(element, 'clientWidth', { value: 290 });
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300 }) as DOMRect;
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = vi.fn();
  return { element, item, custom };
}

function pointerDown(
  target: Element,
  init: Partial<{ ctrlKey: boolean; metaKey: boolean; clientX: number; clientY: number }> = {},
) {
  return {
    target,
    clientX: 10,
    clientY: 10,
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...init,
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function move(element: HTMLElement, clientX: number, clientY: number) {
  act(() => {
    element.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY }));
  });
}

function setup(overrides: Partial<UseMarqueeSelectionOptions> = {}) {
  const dom = createScrollElement();
  const options = {
    hitTest: vi.fn((rect: Rect) => (rect.height > 50 ? ['a', 'b'] : ['a'])),
    getSelected: vi.fn(() => new Set(['z'])),
    apply: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() =>
    useMarqueeSelection({ scrollElement: dom.element, enabled: true, ...options }),
  );
  return { ...dom, ...options, hook };
}

describe('useMarqueeSelection（共用的框選，docs/architecture/frontend/12-file-manager.md §7）', () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('以呼叫端的 hitTest 算命中（傳入內容座標的框），以開始時的選取為底套用', () => {
    const { element, hitTest, apply, hook } = setup();
    act(() => hook.result.current.onPointerDown(pointerDown(element)));
    move(element, 100, 140);

    expect(hitTest).toHaveBeenLastCalledWith({ left: 10, top: 10, width: 90, height: 130 });
    expect(apply).toHaveBeenLastCalledWith(['a', 'b'], 'replace', new Set(['z']));
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['⌘', { metaKey: true }],
  ])('按著 %s 開始 → 疊加', (_label, init) => {
    const { element, apply, hook } = setup();
    act(() => hook.result.current.onPointerDown(pointerDown(element, init)));
    move(element, 40, 40);
    expect(apply).toHaveBeenLastCalledWith(['a'], 'add', new Set(['z']));
  });

  it('拖曳中 hitTest 換了（資料更新）→ 用最新的', () => {
    const { element } = createScrollElement();
    const apply = vi.fn();
    const hook = renderHook(
      ({ hitTest }: { hitTest: (rect: Rect) => readonly string[] }) =>
        useMarqueeSelection({
          scrollElement: element,
          enabled: true,
          hitTest,
          getSelected: () => new Set(),
          apply,
          clear: vi.fn(),
        }),
      { initialProps: { hitTest: (_rect: Rect): readonly string[] => ['a'] } },
    );
    act(() => hook.result.current.onPointerDown(pointerDown(element)));
    hook.rerender({ hitTest: () => ['c'] });
    move(element, 100, 100);
    expect(apply).toHaveBeenLastCalledWith(['c'], 'replace', new Set());
  });

  it('點一下空白處（沒拖曳）→ clear', () => {
    const { element, clear, apply, hook } = setup();
    act(() => hook.result.current.onPointerDown(pointerDown(element)));
    act(() => {
      element.dispatchEvent(new MouseEvent('pointerup'));
    });
    expect(apply).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it(`預設從 ${MARQUEE_ITEM_SELECTOR} 上開始的不是框選`, () => {
    const { item, custom, element, apply, hook } = setup();
    act(() => hook.result.current.onPointerDown(pointerDown(item)));
    move(element, 100, 100);
    expect(apply).not.toHaveBeenCalled();

    // 沒有標記的元素照常可以開始框選
    act(() => hook.result.current.onPointerDown(pointerDown(custom)));
    move(element, 100, 100);
    expect(apply).toHaveBeenCalled();
  });

  it('itemSelector 換成呼叫端自己的標記', () => {
    const { item, custom, element, apply, hook } = setup({ itemSelector: '[data-photo]' });
    act(() => hook.result.current.onPointerDown(pointerDown(custom)));
    move(element, 100, 100);
    expect(apply).not.toHaveBeenCalled();

    act(() => hook.result.current.onPointerDown(pointerDown(item)));
    move(element, 100, 100);
    expect(apply).toHaveBeenCalled();
  });
});
