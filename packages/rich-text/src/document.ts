/*
 * 富文本的文件格式：ProseMirror 的文件 JSON（Tiptap 的 `editor.getJSON()`）。
 * 這是唯一存進資料庫的格式；HTML 與純文字都由它產生（docs/architecture/frontend/07-ui-system.md §3.16、§14）。
 */

/** 行內標記（粗體、連結…）。 */
export interface RichTextMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** 文件裡的一個節點：區塊（段落、清單…）或文字。 */
export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  /** 只有 `text` 節點有。 */
  text?: string;
  marks?: RichTextMark[];
}

/** 一份富文本：根節點一定是 `doc`。 */
export interface RichTextDocument extends RichTextNode {
  type: 'doc';
}

/** 可以開關的格式；編輯器以它決定工具列的按鈕與 schema。 */
export const RICH_TEXT_FORMATS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'link',
] as const;

export type RichTextFormat = (typeof RICH_TEXT_FORMATS)[number];

/** 文件裡可以出現的節點（`doc` 以外）。 */
export const RICH_TEXT_NODE_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'text',
] as const;

export type RichTextNodeType = (typeof RICH_TEXT_NODE_TYPES)[number];

/** 文件裡可以出現的標記。 */
export const RICH_TEXT_MARK_TYPES = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
] as const;

export type RichTextMarkType = (typeof RICH_TEXT_MARK_TYPES)[number];

/** 標題只開放兩層：頁面本身已有 h1，內容從 h2 起。 */
export const RICH_TEXT_HEADING_LEVELS = [2, 3] as const;

/** 只有一個空段落的文件：編輯器清空後回報的就是這個形狀。 */
export const EMPTY_RICH_TEXT_DOCUMENT: RichTextDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * 純文字轉成文件：每一行一個段落（空行是空段落）。
 * 既有的純文字資料轉成富文本時用（例：公告內文的 migration 以同樣的規則在 SQL 裡轉換）。
 */
export function plainTextToRichText(text: string): RichTextDocument {
  const lines = text.split(/\r?\n/);
  return {
    type: 'doc',
    content: lines.map((line) =>
      line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' },
    ),
  };
}
