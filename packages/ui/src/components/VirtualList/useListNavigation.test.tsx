import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useListNavigation } from './useListNavigation';
import type { UseListNavigationOptions } from './useListNavigation';

const LABELS = ['Apple', 'Apricot', 'Banana', 'Blueberry', 'Cherry'];

function key(value: string, init: Partial<KeyboardEvent> = {}) {
  return { key: value, preventDefault: vi.fn(), ...init } as unknown as KeyboardEvent;
}

function renderNavigation(options: Partial<UseListNavigationOptions> = {}) {
  return renderHook((props: Partial<UseListNavigationOptions>) =>
    useListNavigation({
      count: LABELS.length,
      isDisabled: () => false,
      getLabel: (index) => LABELS[index],
      ...options,
      ...props,
    }),
  );
}

function press(result: { current: ReturnType<typeof useListNavigation> }, value: string) {
  let handled = false;
  act(() => {
    handled = result.current.handleKeyDown(key(value));
  });
  return handled;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useListNavigation（aria-activedescendant 的列表導覽）', () => {
  it('沒有作用列時 ↓ 到第一個可用列、↑ 到最後一個可用列', () => {
    const down = renderNavigation({ isDisabled: (index) => index === 0 });
    press(down.result, 'ArrowDown');
    expect(down.result.current.activeIndex).toBe(1);

    const up = renderNavigation({ isDisabled: (index) => index === 4 });
    press(up.result, 'ArrowUp');
    expect(up.result.current.activeIndex).toBe(3);
  });

  it('到底時不繞回（listbox），loop 時繞回（選單）', () => {
    const { result } = renderNavigation();
    press(result, 'End');
    expect(press(result, 'ArrowDown')).toBe(true);
    expect(result.current.activeIndex).toBe(4);

    const looped = renderNavigation({ loop: true });
    press(looped.result, 'End');
    press(looped.result, 'ArrowDown');
    expect(looped.result.current.activeIndex).toBe(0);
    press(looped.result, 'ArrowUp');
    expect(looped.result.current.activeIndex).toBe(4);
  });

  it('PageDown／PageUp 一次移動 pageSize 列，跳過停用的列', () => {
    const { result } = renderNavigation({ pageSize: 2, isDisabled: (index) => index === 2 });
    press(result, 'PageDown');
    // 0 + 2 = 2 停用：往回找到 1
    expect(result.current.activeIndex).toBe(1);
    press(result, 'PageDown');
    expect(result.current.activeIndex).toBe(3);
    press(result, 'PageUp');
    // 3 - 2 = 1
    expect(result.current.activeIndex).toBe(1);
  });

  it('鍵盤移動會呼叫 onNavigate；setActiveIndex（滑鼠）不會', () => {
    const onNavigate = vi.fn();
    const { result } = renderNavigation({ onNavigate });

    act(() => result.current.setActiveIndex(3));
    expect(onNavigate).not.toHaveBeenCalled();

    press(result, 'Home');
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it('typeahead：打字跳到開頭相符的列；連續打字累積比對', () => {
    const { result } = renderNavigation();
    press(result, 'b');
    expect(result.current.activeIndex).toBe(2);
    press(result, 'l');
    expect(result.current.activeIndex).toBe(3);
  });

  it('typeahead：重複同一個字母在同字首的列之間輪替', () => {
    const { result } = renderNavigation();
    press(result, 'a');
    expect(result.current.activeIndex).toBe(0);
    press(result, 'a');
    expect(result.current.activeIndex).toBe(1);
    press(result, 'a');
    expect(result.current.activeIndex).toBe(0);
  });

  it('typeahead：停頓之後重新開始比對', () => {
    const { result } = renderNavigation();
    press(result, 'b');
    act(() => vi.advanceTimersByTime(500));
    press(result, 'c');
    expect(result.current.activeIndex).toBe(4);
  });

  it('typeahead：沒有相符的列時維持原位，但仍算處理過', () => {
    const { result } = renderNavigation();
    press(result, 'c');
    expect(press(result, 'z')).toBe(true);
    expect(result.current.activeIndex).toBe(4);
  });

  it('typeahead 略過停用的列', () => {
    const { result } = renderNavigation({ isDisabled: (index) => index === 2 });
    press(result, 'b');
    expect(result.current.activeIndex).toBe(3);
  });

  it('第一個字是空白、有修飾鍵、或沒有 getLabel 時不處理', () => {
    const { result } = renderNavigation();
    expect(press(result, ' ')).toBe(false);
    let handled = true;
    act(() => {
      handled = result.current.handleKeyDown(key('a', { ctrlKey: true }));
    });
    expect(handled).toBe(false);

    const withoutLabels = renderNavigation({ getLabel: undefined });
    expect(press(withoutLabels.result, 'a')).toBe(false);
    expect(press(withoutLabels.result, 'Tab')).toBe(false);
  });

  it('沒有列時不處理任何按鍵；firstEnabled 回傳 -1', () => {
    const { result } = renderNavigation({ count: 0 });
    expect(press(result, 'ArrowDown')).toBe(false);
    expect(result.current.firstEnabled()).toBe(-1);
  });

  it('列數變少時作用列夾回範圍內', () => {
    const { result, rerender } = renderNavigation();
    press(result, 'End');

    rerender({ count: 2 });

    expect(result.current.activeIndex).toBe(1);
  });

  it('全部停用時方向鍵維持沒有作用列', () => {
    const { result } = renderNavigation({ isDisabled: () => true });
    expect(press(result, 'ArrowDown')).toBe(true);
    expect(result.current.activeIndex).toBe(-1);
    expect(result.current.firstEnabled()).toBe(-1);
  });
});
