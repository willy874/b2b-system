export * from './RichTextViewer';
// 格式定義與轉換在 `@b2b-system/rich-text`；app 不直接依賴它（docs/coding-standards/07-layer-dependencies.md §1），由這裡轉出用得到的部分
export {
  EMPTY_RICH_TEXT_DOCUMENT,
  RICH_TEXT_FORMATS,
  isRichTextEmpty,
  isValidRichTextDocument,
  plainTextToRichText,
  richTextToPlainText,
} from '@b2b-system/rich-text';
export type {
  RichTextDocument,
  RichTextFormat,
  RichTextMark,
  RichTextNode,
  ValidRichTextDocument,
} from '@b2b-system/rich-text';
