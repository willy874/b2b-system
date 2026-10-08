import {
  createRichTextDocumentSchema,
  RichTextDocumentShapeSchema,
  RichTextMarkSchema,
  RichTextNodeSchema,
} from '@b2b-system/rich-text/schema';
import type { RichTextDocumentSchemaOptions } from '@b2b-system/rich-text/schema';

import { defineSchema } from './zod-openapi';

/*
 * 富文本（docs/architecture/frontend/07-ui-system.md §3.16）：格式定義在 `@b2b-system/rich-text`，與前端的編輯器共用。
 * 這裡把 schema 登記成具名的 OpenAPI 元件：節點是遞迴的，要以 `$ref` 指回自己；前端的 SDK 因此有對應的型別。
 */
defineSchema('RichTextMark', RichTextMarkSchema);
defineSchema('RichTextNode', RichTextNodeSchema);

/** 回應裡的富文本（已驗證過才存進資料庫，回應不再檢查內容規則）。 */
export const RichTextDocumentSchema = defineSchema('RichTextDocument', RichTextDocumentShapeSchema);

/**
 * 請求裡的富文本：形狀 ＋ 與編輯器 schema 相同的內容規則、深度與節點數、純文字的字數與必填。
 * 不合法時回 `400 VALIDATION_FAILED`，`details` 的路徑指到出錯的節點。
 */
export function richTextInput(options: RichTextDocumentSchemaOptions = {}) {
  return createRichTextDocumentSchema(options);
}
