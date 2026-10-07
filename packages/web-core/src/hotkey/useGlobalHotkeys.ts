import { useEffect } from 'react';

import { findHotkey } from './registry';

/**
 * 在 `window` 上分派登記的全域快捷鍵。整個 app 只掛一次（`DashboardShell`）；登入前的頁面不掛，
 * 快捷鍵打開的東西（命令面板）都需要登入後的資料。
 */
export function useGlobalHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hotkey = findHotkey(event);
      if (!hotkey) return;
      // 擋掉瀏覽器的預設行為（Chrome 的 ⌘K 是聚焦網址列、Firefox 是搜尋列）
      event.preventDefault();
      hotkey.run(event);
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, []);
}
