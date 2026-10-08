import { z } from 'zod';

import { RICH_TEXT_MARK_TYPES, RICH_TEXT_NODE_TYPES } from './document.js';
import type { RichTextDocument, RichTextMark, RichTextNode } from './document.js';
import { richTextToPlainText } from './plain-text.js';
import { findRichTextIssue } from './validate.js';
import type { RichTextLimits } from './validate.js';

/*
 * zod schema（`@b2b-system/rich-text/schema`）：api 的 DTO 以它驗證、產生 OpenAPI。
 * 另成一個子路徑，前端只用到 JSON 的地方不會帶進 zod。
 */

const AttrsSchema = z.record(z.string(), z.unknown());

export const RichTextMarkSchema: z.ZodType<RichTextMark> = z.object({
  type: z.enum(RICH_TEXT_MARK_TYPES),
  attrs: AttrsSchema.optional(),
});

/**
 * 一個節點；`content` 是遞迴的（OpenAPI 以 `$ref` 指回自己，呼叫端以具名 schema 登記）。
 * 型別標成 `RichTextNode`：驗證時 `type` 只收白名單，輸出的型別與其他程式碼用的介面相同。
 */
export const RichTextNodeSchema: z.ZodType<RichTextNode> = z.object({
  type: z.enum(RICH_TEXT_NODE_TYPES),
  attrs: AttrsSchema.optional(),
  get content(): z.ZodOptional<z.ZodArray<z.ZodType<RichTextNode>>> {
    return z.array(RichTextNodeSchema).optional();
  },
  text: z.string().optional(),
  marks: z.array(RichTextMarkSchema).optional(),
});

/** 文件的形狀（只驗欄位型別）；內容規則、上限另由 `createRichTextDocumentSchema` 檢查。 */
export const RichTextDocumentShapeSchema: z.ZodType<RichTextDocument> = z.object({
  type: z.literal('doc'),
  content: z.array(RichTextNodeSchema),
});

export interface RichTextDocumentSchemaOptions extends RichTextLimits {
  /** 純文字（`richTextToPlainText`）的字數上限。 */
  maxLength?: number;
  /** 必填：至少要有一個字（`isRichTextEmpty` 為 false）。預設 false。 */
  required?: boolean;
}

/**
 * 完整的驗證：形狀 ＋ 與編輯器 schema 相同的內容規則（`findRichTextIssue`）＋ 字數與必填。
 * 錯誤的 `path` 指到出錯的節點，訊息是 zh-TW。
 */
export function createRichTextDocumentSchema({
  maxLength,
  required = false,
  ...limits
}: RichTextDocumentSchemaOptions = {}) {
  return RichTextDocumentShapeSchema.superRefine((document, context) => {
    const issue = findRichTextIssue(document, limits);
    if (issue) {
      context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      return;
    }
    const text = richTextToPlainText(document);
    if (required && text.trim() === '') {
      context.addIssue({ code: 'custom', path: [], message: '內容不能是空的' });
    } else if (maxLength !== undefined && text.length > maxLength) {
      context.addIssue({ code: 'custom', path: [], message: `內容超過 ${maxLength} 字` });
    }
  });
}
