import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeFileLayout } from '../layout';
import type { FileSelection } from '../useFileSelection';
import { useMarqueeSelection } from '../useMarqueeSelection';

/** 列表模式：每列 48 px、寬 300 px；第 3 格是佔位（框到也不選）。 */
const IDS = ['a', 'b', undefined, 'd', 'e', 'f', 'g', 'h'];
const LAYOUT = computeFileLayout('list', 300, IDS.length);

let frames: FrameRequestCallback[];

function createScrollElement() {
  const element = document.createElement('div');
  const item = document.createElement('div');
  item.setAttribute('data-file-item', '');
  const button = document.createElement('button');
  element.append(item, button);
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
  const captured = new Set<number>();
  element.setPointerCapture = (id) => captured.add(id);
  element.hasPointerCapture = (id) => captured.has(id);
  element.releasePointerCapture = vi.fn((id: number) => captured.delete(id));
  return { element, item, button };
}

function createSelection(selected: string[] = []) {
  return {
    selected: new Set(selected),
    apply: vi.fn(),
    clear: vi.fn(),
  } as unknown as FileSelection & {
    apply: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
}

function pointerDown(
  target: Element,
  init: Partial<{
    clientX: number;
    clientY: number;
    button: number;
    pointerType: string;
    shiftKey: boolean;
  }> = {},
) {
  const preventDefault = vi.fn();
  const event = {
    target,
    clientX: 10,
    clientY: 10,
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault,
    ...init,
  } as unknown as ReactPointerEvent<HTMLElement>;
  return { event, preventDefault };
}

function move(element: HTMLElement, clientX: number, clientY: number) {
  act(() => {
    element.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY }));
  });
}

function up(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent('pointerup'));
  });
}

function setup(options: { enabled?: boolean; selected?: string[]; noElement?: boolean } = {}) {
  const dom = createScrollElement();
  const selection = createSelection(options.selected);
  const hook = renderHook(() =>
    useMarqueeSelection({
      scrollElement: options.noElement ? null : dom.element,
      layout: LAYOUT,
      ids: IDS,
      selection,
      enabled: options.enabled ?? true,
    }),
  );
  return { ...dom, selection, hook };
}

describe('useMarqueeSelection（框選，docs/architecture/frontend/12-file-manager.md §7）', () => {
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

  it('在空白處拖曳 → 顯示框並以版面計算命中的項目（略過佔位格），取代原本的選取', () => {
    const { element, selection, hook } = setup({ selected: ['h'] });
    const { event, preventDefault } = pointerDown(element);
    act(() => hook.result.current.onPointerDown(event));
    expect(preventDefault).toHaveBeenCalled();

    move(element, 100, 140);

    expect(hook.result.current.marquee).toEqual({ left: 10, top: 10, width: 90, height: 130 });
    expect(selection.apply).toHaveBeenLastCalledWith(['a', 'b'], 'replace', new Set(['h']));
  });

  it('按著 Shift 開始 → 疊加在原本的選取上', () => {
    const { element, selection, hook } = setup({ selected: ['h'] });
    act(() => hook.result.current.onPointerDown(pointerDown(element, { shiftKey: true }).event));
    move(element, 50, 60);
    expect(selection.apply).toHaveBeenLastCalledWith(['a', 'b'], 'add', new Set(['h']));
  });

  it('移動不到門檻就放開 → 視為點擊空白處，清空選取、不顯示框', () => {
    const { element, selection, hook } = setup({ selected: ['a'] });
    act(() => hook.result.current.onPointerDown(pointerDown(element).event));
    move(element, 12, 12);
    expect(selection.apply).not.toHaveBeenCalled();
    expect(hook.result.current.marquee).toBeUndefined();

    up(element);
    expect(selection.clear).toHaveBeenCalledTimes(1);
  });

  it('按著 Shift 點一下空白處 → 不清空選取', () => {
    const { element, selection, hook } = setup({ selected: ['a'] });
    act(() => hook.result.current.onPointerDown(pointerDown(element, { shiftKey: true }).event));
    up(element);
    expect(selection.clear).not.toHaveBeenCalled();
  });

  it('放開後收起框、釋放指標並停止追蹤', () => {
    const { element, selection, hook } = setup();
    act(() => hook.result.current.onPointerDown(pointerDown(element).event));
    move(element, 100, 100);
    expect(hook.result.current.marquee).toBeDefined();

    up(element);
    expect(hook.result.current.marquee).toBeUndefined();
    expect(selection.clear).not.toHaveBeenCalled();
    expect(element.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(cancelAnimationFrame).toHaveBeenCalled();

    const calls = selection.apply.mock.calls.length;
    move(element, 200, 200);
    expect(selection.apply).toHaveBeenCalledTimes(calls);
  });

  it('拖到下緣自動往下捲，框的起點固定在內容座標上', () => {
    const { element, selection, hook } = setup();
    act(() => hook.result.current.onPointerDown(pointerDown(element).event));
    move(element, 100, 290);
    act(() => frames.at(-1)?.(0));

    // 距下緣 10 px：24 × (1 − 10 / 48) = 19
    expect(element.scrollTop).toBeCloseTo(19);
    expect(hook.result.current.marquee?.top).toBe(10);
    expect(hook.result.current.marquee?.height).toBeCloseTo(290 + 19 - 10);
    expect(selection.apply).toHaveBeenLastCalledWith(
      ['a', 'b', 'd', 'e', 'f', 'g'],
      'replace',
      new Set(),
    );
  });

  it('拖到上緣自動往上捲；還沒開始拖曳時不捲動', () => {
    const { element, hook } = setup();
    element.scrollTop = 100;
    act(() => hook.result.current.onPointerDown(pointerDown(element, { clientY: 150 }).event));
    act(() => frames.at(-1)?.(0));
    expect(element.scrollTop).toBe(100);

    move(element, 100, 0);
    act(() => frames.at(-1)?.(0));
    expect(element.scrollTop).toBe(76);
  });

  it('指標在中間時不捲動', () => {
    const { element, hook } = setup();
    act(() => hook.result.current.onPointerDown(pointerDown(element).event));
    move(element, 100, 150);
    act(() => frames.at(-1)?.(0));
    expect(element.scrollTop).toBe(0);
  });

  it('卸載時清掉進行中的拖曳', () => {
    const { element, selection, hook } = setup();
    act(() => hook.result.current.onPointerDown(pointerDown(element).event));
    hook.unmount();
    element.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 100 }));
    expect(selection.apply).not.toHaveBeenCalled();
  });

  it.each([
    ['停用', { enabled: false }, {}],
    ['沒有捲動容器', { noElement: true }, {}],
    ['不是左鍵', {}, { button: 2 }],
    ['觸控（拖曳是捲動）', {}, { pointerType: 'touch' }],
    ['按在捲軸上', {}, { clientX: 295 }],
  ])('%s → 不開始框選', (_label, options, init) => {
    const { element, selection, hook } = setup(options);
    const { event, preventDefault } = pointerDown(element, init);
    act(() => hook.result.current.onPointerDown(event));
    move(element, 100, 100);
    up(element);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(selection.apply).not.toHaveBeenCalled();
    expect(selection.clear).not.toHaveBeenCalled();
  });

  it('從項目或控制項上開始的是點擊，不是框選', () => {
    const { item, button, element, selection, hook } = setup();
    act(() => hook.result.current.onPointerDown(pointerDown(item).event));
    act(() => hook.result.current.onPointerDown(pointerDown(button).event));
    move(element, 100, 100);
    expect(selection.apply).not.toHaveBeenCalled();
  });
});
