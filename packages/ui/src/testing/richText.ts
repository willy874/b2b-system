import type { TiptapEditorHTMLElement } from '@tiptap/core';

/*
 * `RichTextEditor` 的測試輔助（docs/architecture/frontend/07-ui-system.md §3.16）：jsdom 沒辦法模擬 contenteditable 的輸入，
 * 也沒有 ProseMirror 捲動到游標時要的版面 API。app 的頁面測試經由這裡操作編輯器，不必直接依賴 Tiptap。
 */

/** jsdom 沒有 `Range` 的版面 API：補上回傳空量測結果的替身（`beforeAll` 呼叫一次）。 */
export function installRangeLayoutStub(): void {
  Range.prototype.getClientRects ??= () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
}

/**
 * 在編輯區（`getByRole('textbox')` 拿到的元素）的游標位置插入文字（純文字或 HTML），等同使用者輸入或貼上。
 * 會觸發 `onChange`；呼叫端自己包 `act()`。
 */
export function insertRichText(textbox: HTMLElement, content: string): void {
  const { editor } = textbox as TiptapEditorHTMLElement;
  if (!editor) throw new Error('這個元素不是 RichTextEditor 的編輯區');
  editor.commands.insertContent(content);
}
