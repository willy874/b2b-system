import { plainTextToRichText, richTextToPlainText } from '@b2b-system/rich-text';
import type { RichTextDocument } from '@b2b-system/rich-text';

/*
 * 內文的兩個欄位（docs/architecture/backend/19-announcement.md §9.2 D22）：`body_doc` 是富文本的文件 JSON，顯示以它為準；
 * `body` 是它的純文字（搜尋、字數、稽核）。
 */

/** 讀內文：還沒有 `body_doc` 的列（部署期間舊版 api 寫入的）以純文字的 `body` 轉換。 */
export function bodyDocumentOf(row: {
  body: string;
  bodyDoc: RichTextDocument | null;
}): RichTextDocument {
  return row.bodyDoc ?? plainTextToRichText(row.body);
}

/** 寫內文：文件存 `body_doc`，純文字存 `body`。 */
export function bodyColumns(document: RichTextDocument): {
  body: string;
  bodyDoc: RichTextDocument;
} {
  return { body: richTextToPlainText(document), bodyDoc: document };
}
