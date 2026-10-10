/**
 * 使用者正在打字、或焦點在自己處理方向鍵的控制項（下拉、清單、選單）的地方：
 * 全域快捷鍵與元件內的按鍵（檔案的 LightBox、圖片庫的檢視器）都不攔截。
 * 三處原本各寫一份選擇器而且不一致，之後加控制項時只改這裡。
 */
const TYPING_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="listbox"], [role="combobox"], [role="menu"]';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest(TYPING_SELECTOR) !== null;
}
