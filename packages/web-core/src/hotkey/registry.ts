import { createRegistry } from '@b2b-system/web-shared/registry';

import { hotkeyId, isMacPlatform, matchesHotkey, parseHotkey } from './combo';
import type { ParsedHotkey } from './combo';
import { isTypingTarget } from './typingTarget';

export interface Hotkey {
  /** `mod+k`、`shift+/`；`mod` 在 macOS 是 ⌘、其他平台是 Ctrl。 */
  combo: string;
  /**
   * 焦點在輸入框、可編輯區時也觸發。預設 `false`：使用者在打字時，單一按鍵（`/`、`?`）不能被攔走。
   * 帶 `mod` 的組合（⌘K）通常要設 `true`，否則在搜尋框裡按不出來。
   */
  allowInInput?: boolean;
  run: (event: KeyboardEvent) => void;
}

interface HotkeyEntry {
  parsed: ParsedHotkey;
  hotkey: Hotkey;
}

/** 以「實際的按鍵組合」為鍵：`mod+k` 與 macOS 上的 `meta+k` 是同一個，重複登記丟例外（衝突偵測）。 */
export const hotkeyRegistry = createRegistry<string, HotkeyEntry>('Hotkey');

/**
 * 登記全域快捷鍵（plugin 的同步階段，或 web-core 的模組自己的 `registerXxx()`）。回傳反註冊函式。
 * 只有掛了 `useGlobalHotkeys()` 的外框（`DashboardShell`）會分派；元件內的按鍵（燈箱的方向鍵）照舊寫在元件裡。
 */
export function registerHotkey(hotkey: Hotkey, isMac: boolean = isMacPlatform()): () => void {
  const parsed = parseHotkey(hotkey.combo, isMac);
  return hotkeyRegistry.register(hotkeyId(parsed), { parsed, hotkey });
}

/** 找出這次按鍵要執行的快捷鍵；沒有就回 undefined（不攔，交給瀏覽器與元件）。 */
export function findHotkey(
  event: KeyboardEvent,
  entries: Iterable<HotkeyEntry> = hotkeyRegistry.values(),
): Hotkey | undefined {
  // 輸入法組字中的 Enter、方向鍵不是快捷鍵；已被元件處理過的也不搶
  if (event.isComposing || event.defaultPrevented) return undefined;
  const editable = isTypingTarget(event.target);
  for (const { parsed, hotkey } of entries) {
    if (!matchesHotkey(event, parsed)) continue;
    if (editable && !hotkey.allowInInput) return undefined;
    return hotkey;
  }
  return undefined;
}

/** 測試用。 */
export function resetHotkeyRegistry(): void {
  hotkeyRegistry.reset();
}
