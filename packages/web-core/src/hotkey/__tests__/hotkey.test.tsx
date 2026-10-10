import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatHotkey, parseHotkey } from '../combo';
import { findHotkey, registerHotkey, resetHotkeyRegistry } from '../registry';
import { isTypingTarget } from '../typingTarget';
import { useGlobalHotkeys } from '../useGlobalHotkeys';

function Listener() {
  useGlobalHotkeys();
  return (
    <>
      <input data-testid="input" />
      <div data-testid="plain" tabIndex={-1} />
    </>
  );
}

beforeEach(() => resetHotkeyRegistry());

describe('快捷鍵的組合', () => {
  it.each([
    ['mod+k', true, { ctrl: false, meta: true, alt: false, shift: false, key: 'k' }],
    ['mod+k', false, { ctrl: true, meta: false, alt: false, shift: false, key: 'k' }],
    ['shift+/', false, { ctrl: false, meta: false, alt: false, shift: true, key: '/' }],
  ])('%s（macOS=%s）', (combo, isMac, expected) => {
    expect(parseHotkey(combo, isMac)).toEqual(expected);
  });

  it('格式不對丟例外', () => {
    expect(() => parseHotkey('k+mod', true)).toThrow('快捷鍵格式不對');
    expect(() => parseHotkey('hyper+k', true)).toThrow('快捷鍵格式不對');
  });

  it('顯示：macOS ⌘K，其他平台 Ctrl+K', () => {
    expect(formatHotkey('mod+k', true)).toBe('⌘K');
    expect(formatHotkey('mod+k', false)).toBe('Ctrl+K');
  });

  it('同一個實際組合只能登記一次：macOS 上的 mod+k 與 meta+k 衝突', () => {
    registerHotkey({ combo: 'mod+k', run: () => undefined }, true);
    expect(() => registerHotkey({ combo: 'meta+k', run: () => undefined }, true)).toThrow(
      'already registered',
    );
  });
});

describe('useGlobalHotkeys（分派）', () => {
  it('按下登記的組合時執行，並擋掉瀏覽器的預設行為', () => {
    const run = vi.fn();
    registerHotkey({ combo: 'ctrl+k', run }, false);
    const { getByTestId } = render(<Listener />);
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    getByTestId('plain').dispatchEvent(event);
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('焦點在輸入框時預設不觸發；allowInInput 才觸發', () => {
    const plain = vi.fn();
    const allowed = vi.fn();
    registerHotkey({ combo: 'shift+/', run: plain }, false);
    registerHotkey({ combo: 'ctrl+k', allowInInput: true, run: allowed }, false);
    const { getByTestId } = render(<Listener />);
    fireEvent.keyDown(getByTestId('input'), { key: '/', shiftKey: true });
    fireEvent.keyDown(getByTestId('input'), { key: 'k', ctrlKey: true });
    expect(plain).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledOnce();
  });

  it('修飾鍵不同、輸入法組字中都不算', () => {
    registerHotkey({ combo: 'ctrl+k', run: () => undefined }, false);
    const target = document.body;
    const make = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { key: 'k', bubbles: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    expect(findHotkey(make({ ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(findHotkey(make({ ctrlKey: true, isComposing: true }))).toBeUndefined();
    expect(findHotkey(make({ ctrlKey: true }))).toBeDefined();
  });
});

describe('isTypingTarget', () => {
  it.each([
    ['<input />', true],
    ['<textarea></textarea>', true],
    ['<select></select>', true],
    ['<div contenteditable="true"></div>', true],
    ['<div role="listbox"><span data-target></span></div>', true],
    ['<div role="combobox"></div>', true],
    ['<div role="menu"><button data-target></button></div>', true],
    ['<div contenteditable="false"></div>', false],
    ['<button></button>', false],
    ['<div></div>', false],
  ])('%s → %s', (html, expected) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    const target = host.querySelector('[data-target]') ?? host.firstElementChild;
    expect(isTypingTarget(target)).toBe(expected);
    host.remove();
  });

  it('不是元素（window、null）→ false', () => {
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
