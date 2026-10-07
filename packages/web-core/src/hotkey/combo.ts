/** 修飾鍵；`mod` 在 macOS 是 ⌘，其他平台是 Ctrl。 */
const MODIFIERS = ['mod', 'ctrl', 'meta', 'alt', 'shift'] as const;
type Modifier = (typeof MODIFIERS)[number];

export interface ParsedHotkey {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** 小寫的 `KeyboardEvent.key`，例：`k`、`/`、`escape`。 */
  key: string;
}

const isModifier = (token: string): token is Modifier =>
  (MODIFIERS as readonly string[]).includes(token);

/**
 * `mod+k`、`shift+/` → 實際要比對的按鍵。`mod` 在這裡依平台換成 meta 或 ctrl，
 * 所以 `mod+k` 與 `meta+k` 在 macOS 上是同一個組合（註冊表以此偵測衝突）。
 */
export function parseHotkey(combo: string, isMac: boolean): ParsedHotkey {
  const tokens = combo.toLowerCase().split('+');
  const key = tokens.pop();
  if (!key || isModifier(key) || tokens.some((token) => !isModifier(token))) {
    throw new Error(`快捷鍵格式不對：${combo}（例：mod+k、shift+/）`);
  }
  const has = (modifier: Modifier) => tokens.includes(modifier);
  return {
    ctrl: has('ctrl') || (!isMac && has('mod')),
    meta: has('meta') || (isMac && has('mod')),
    alt: has('alt'),
    shift: has('shift'),
    key,
  };
}

/** 註冊表的鍵：同一個實際組合只有一種寫法。 */
export function hotkeyId(parsed: ParsedHotkey): string {
  return [
    parsed.ctrl && 'ctrl',
    parsed.meta && 'meta',
    parsed.alt && 'alt',
    parsed.shift && 'shift',
    parsed.key,
  ]
    .filter(Boolean)
    .join('+');
}

export function matchesHotkey(event: KeyboardEvent, parsed: ParsedHotkey): boolean {
  return (
    event.key.toLowerCase() === parsed.key &&
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift
  );
}

/** 顯示用：macOS `⌘K`，其他平台 `Ctrl+K`。 */
export function formatHotkey(combo: string, isMac: boolean): string {
  const parsed = parseHotkey(combo, isMac);
  const key = parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key;
  if (isMac) {
    return [parsed.ctrl && '⌃', parsed.alt && '⌥', parsed.shift && '⇧', parsed.meta && '⌘', key]
      .filter(Boolean)
      .join('');
  }
  return [
    parsed.ctrl && 'Ctrl',
    parsed.alt && 'Alt',
    parsed.shift && 'Shift',
    parsed.meta && 'Win',
    key,
  ]
    .filter(Boolean)
    .join('+');
}

/** 判斷 macOS（含 iPadOS 的實體鍵盤）；`navigator.userAgentData` 只有 Chromium 有，其餘退回 `platform`。 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}
