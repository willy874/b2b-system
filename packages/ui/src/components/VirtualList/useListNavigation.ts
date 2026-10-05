import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useLatestRef } from '../useLatestRef';

export interface UseListNavigationOptions {
  count: number;
  isDisabled: (index: number) => boolean;
  /** 供 typeahead 比對的文字；回傳 `undefined` 的列不參與。 */
  getLabel?: (index: number) => string | undefined;
  /** 鍵盤移動焦點後呼叫（通常是把該列捲進可視範圍）。滑鼠移過不會呼叫。 */
  onNavigate?: (index: number) => void;
  /** 到底後是否繞回開頭（選單是 `true`，listbox 是 `false`）。 */
  loop?: boolean;
  pageSize?: number;
}

export interface ListNavigation {
  /** 目前的作用列；`-1` 表示沒有。 */
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** 由鍵盤移到某一列（會觸發 `onNavigate`）。 */
  navigateTo: (index: number) => void;
  /** 第一個可用的列；沒有時是 `-1`。 */
  firstEnabled: () => number;
  /** 處理方向鍵、Home/End、PageUp/PageDown 與 typeahead；有處理就回傳 `true` 並 `preventDefault`。 */
  handleKeyDown: (event: KeyboardEvent) => boolean;
}

const TYPEAHEAD_RESET_MS = 500;

interface TypeaheadState {
  buffer: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface TypeaheadContext {
  count: number;
  activeIndex: number;
  isDisabled: (index: number) => boolean;
  getLabel?: (index: number) => string | undefined;
}

/** 可列印字元：累積成字串，從作用列之後找第一個開頭相符的列；不是 typeahead 按鍵時回傳 `null`。 */
function matchTypeahead(
  event: KeyboardEvent,
  state: TypeaheadState,
  { count, activeIndex, isDisabled, getLabel }: TypeaheadContext,
): number | null {
  if (!getLabel || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  // 第一個字是空白時交給呼叫端（空白鍵要拿來選取）
  if (state.buffer === '' && event.key === ' ') return null;
  clearTimeout(state.timer);
  state.buffer += event.key.toLocaleLowerCase();
  state.timer = setTimeout(() => {
    state.buffer = '';
  }, TYPEAHEAD_RESET_MS);
  // 重複同一個字母時在同字首的項目間輪替；否則從作用列本身開始比對（持續打字時留在原地）
  const isRepeat = state.buffer.length > 1 && new Set(state.buffer).size === 1;
  const query = isRepeat ? state.buffer.slice(0, 1) : state.buffer;
  const start = isRepeat || state.buffer.length === 1 ? activeIndex + 1 : Math.max(activeIndex, 0);
  for (let offset = 0; offset < count; offset += 1) {
    const index = (start + offset) % count;
    if (isDisabled(index)) continue;
    if (getLabel(index)?.toLocaleLowerCase().startsWith(query)) return index;
  }
  return -1;
}

/**
 * 以 `aria-activedescendant` 管理的列表導覽：焦點留在列表容器，作用列只是一個 index。
 * 虛擬捲動時列元素不一定存在，所以不用 roving tabindex。
 */
export function useListNavigation({
  count,
  isDisabled,
  getLabel,
  onNavigate,
  loop = false,
  pageSize = 10,
}: UseListNavigationOptions): ListNavigation {
  const [storedIndex, setActiveIndex] = useState(-1);
  // 列數變少（例如收合、重新載入）時把作用列夾回範圍內
  const activeIndex = Math.min(storedIndex, count - 1);
  const latest = useLatestRef({
    count,
    isDisabled,
    getLabel,
    onNavigate,
    loop,
    pageSize,
    activeIndex,
  });

  /** 從 `from` 開始往 `step` 方向找第一個可用列（包含 `from` 自己）。 */
  const seek = useCallback(
    (from: number, step: 1 | -1, wrap: boolean): number => {
      const { count: total, isDisabled: disabled } = latest.current;
      for (let offset = 0; offset < total; offset += 1) {
        let index = from + offset * step;
        if (wrap) index = ((index % total) + total) % total;
        else if (index < 0 || index >= total) return -1;
        if (!disabled(index)) return index;
      }
      return -1;
    },
    [latest],
  );

  const navigateTo = useCallback(
    (index: number) => {
      if (index < 0) return;
      setActiveIndex(index);
      latest.current.onNavigate?.(index);
    },
    [latest],
  );

  const firstEnabled = useCallback(() => seek(0, 1, false), [seek]);

  const typeahead = useRef<TypeaheadState>({ buffer: '', timer: undefined });
  useEffect(() => {
    const state = typeahead.current;
    return () => clearTimeout(state.timer);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const { count: total, loop: wrap, pageSize: page, activeIndex: current } = latest.current;
      if (total === 0) return false;
      let next: number | null = null;
      switch (event.key) {
        case 'ArrowDown':
          next = current < 0 ? seek(0, 1, false) : seek(current + 1, 1, wrap);
          break;
        case 'ArrowUp':
          next = current < 0 ? seek(total - 1, -1, false) : seek(current - 1, -1, wrap);
          break;
        case 'Home':
          next = seek(0, 1, false);
          break;
        case 'End':
          next = seek(total - 1, -1, false);
          break;
        case 'PageDown':
          next = seek(Math.min(total - 1, Math.max(current, 0) + page), -1, false);
          break;
        case 'PageUp':
          next = seek(Math.max(0, current - page), 1, false);
          break;
        default:
          next = matchTypeahead(event, typeahead.current, latest.current);
      }
      if (next === null) return false;
      event.preventDefault();
      // 已經在盡頭（沒有下一個可用列）時維持原位
      if (next >= 0) navigateTo(next);
      return true;
    },
    [latest, navigateTo, seek],
  );

  return { activeIndex, setActiveIndex, navigateTo, firstEnabled, handleKeyDown };
}
