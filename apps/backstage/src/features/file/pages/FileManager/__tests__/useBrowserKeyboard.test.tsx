import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { BrowserItemVM } from '../adapter';
import { computeFileLayout } from '../layout';
import { useBrowserKeyboard } from '../useBrowserKeyboard';
import type { UseBrowserKeyboardOptions } from '../useBrowserKeyboard';
import type { FileSelection } from '../useFileSelection';

const ITEMS = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id }) as BrowserItemVM);
/** 列表排版：一列一個，↑↓ 移一個 */
const LAYOUT = computeFileLayout('list', 800, ITEMS.length);

function fakeSelection(selected: string[] = []): FileSelection {
  return {
    selected: new Set(selected),
    anchor: undefined,
    click: vi.fn(),
    apply: vi.fn(),
    selectAll: vi.fn(),
    clear: vi.fn(),
    isSelected: (id: string) => selected.includes(id),
  };
}

/** 容器本身收到的按鍵（不是從子元素冒上來的）。 */
function key(name: string, init: Partial<KeyboardEvent<HTMLDivElement>> = {}) {
  const target = document.createElement('div');
  return {
    key: name,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    target,
    currentTarget: target,
    preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent<HTMLDivElement>;
}

function renderKeyboard(overrides: Partial<UseBrowserKeyboardOptions> = {}) {
  const options: UseBrowserKeyboardOptions = {
    items: ITEMS,
    layout: LAYOUT,
    selection: fakeSelection(),
    currentFolderId: 'root',
    onOpen: vi.fn(),
    onDeleteSelected: vi.fn(),
    scrollToIndex: vi.fn(),
    ...overrides,
  };
  const hook = renderHook((props: UseBrowserKeyboardOptions) => useBrowserKeyboard(props), {
    initialProps: options,
  });
  return { ...hook, options };
}

describe('useBrowserKeyboard（檔案瀏覽區的焦點與鍵盤）', () => {
  it('↓ 移動焦點、捲到它並只選它；Shift 延伸、Ctrl／⌘ 只移焦點', () => {
    const { result, options } = renderKeyboard();
    act(() => result.current.onKeyDown(key('ArrowDown')));
    expect(result.current.focused?.id).toBe('a');
    expect(options.scrollToIndex).toHaveBeenLastCalledWith(0);
    expect(options.selection.click).toHaveBeenLastCalledWith('a');

    act(() => result.current.onKeyDown(key('ArrowDown', { shiftKey: true })));
    expect(options.selection.click).toHaveBeenLastCalledWith('b', { shift: true });

    act(() => result.current.onKeyDown(key('ArrowDown', { ctrlKey: true })));
    expect(result.current.focused?.id).toBe('c');
    expect(options.selection.click).toHaveBeenCalledTimes(2);
  });

  it('空白鍵切換焦點項目、Enter 開啟它', () => {
    const { result, options } = renderKeyboard();
    act(() => result.current.setFocusIndex(2));
    act(() => result.current.onKeyDown(key(' ')));
    expect(options.selection.click).toHaveBeenCalledWith('c', { toggle: true });
    act(() => result.current.onKeyDown(key('Enter')));
    expect(options.onOpen).toHaveBeenCalledWith(ITEMS[2]);
  });

  it('Ctrl+A 全選；有選取時 Esc 取消、Delete 刪除', () => {
    const selection = fakeSelection(['a']);
    const { result, options } = renderKeyboard({ selection });
    act(() => result.current.onKeyDown(key('a', { metaKey: true })));
    expect(selection.selectAll).toHaveBeenCalled();
    act(() => result.current.onKeyDown(key('Escape')));
    expect(selection.clear).toHaveBeenCalled();
    act(() => result.current.onKeyDown(key('Delete')));
    expect(options.onDeleteSelected).toHaveBeenCalled();
  });

  it('沒有選取時 Esc、Delete 不攔下（交給瀏覽器）', () => {
    const { result, options } = renderKeyboard();
    const escape = key('Escape');
    act(() => result.current.onKeyDown(escape));
    act(() => result.current.onKeyDown(key('Backspace')));
    expect(escape.preventDefault).not.toHaveBeenCalled();
    expect(options.onDeleteSelected).not.toHaveBeenCalled();
  });

  it('從子元素冒上來的按鍵不處理（例：卡片裡的勾選框）', () => {
    const { result, options } = renderKeyboard();
    act(() =>
      result.current.onKeyDown(key('ArrowDown', { target: document.createElement('input') })),
    );
    expect(result.current.focusIndex).toBe(-1);
    expect(options.selection.click).not.toHaveBeenCalled();
  });

  it('換資料夾：焦點不留在同一個位置', () => {
    const { result, rerender, options } = renderKeyboard();
    act(() => result.current.setFocusIndex(1));
    rerender({ ...options, currentFolderId: 'other' });
    expect(result.current.focusIndex).toBe(-1);
  });
});
