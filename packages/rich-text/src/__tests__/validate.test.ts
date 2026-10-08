import { describe, expect, it } from 'vitest';

import { findRichTextIssue, isValidRichTextDocument } from '../index';
import type { RichTextDocument, RichTextNode } from '../index';
import { createRichTextDocumentSchema, RichTextNodeSchema } from '../schema';

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: RichTextNode[]): RichTextNode => ({ type: 'paragraph', content });
const doc = (...content: RichTextNode[]): RichTextDocument => ({ type: 'doc', content });

describe('findRichTextIssue（與編輯器的 schema 相同的內容規則）', () => {
  it('合法的文件沒有問題', () => {
    expect(
      findRichTextIssue(
        doc(
          { type: 'heading', attrs: { level: 2 }, content: [text('t', [{ type: 'bold' }])] },
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [paragraph(text('a')), { type: 'horizontalRule' }] },
            ],
          },
          { type: 'paragraph' },
        ),
      ),
    ).toBeUndefined();
  });

  it.each<[string, RichTextNode, Array<string | number>]>([
    ['根節點不是 doc', paragraph(), ['type']],
    ['沒有內容的 doc', { type: 'doc', content: [] }, ['content']],
    ['不支援的節點', doc({ type: 'image' }), ['content', 0]],
    ['doc 裡直接放文字', doc(text('x')), ['content', 0]],
    ['段落裡放段落', doc(paragraph(paragraph())), ['content', 0, 'content', 0]],
    [
      '清單裡放段落',
      doc({ type: 'bulletList', content: [paragraph()] }),
      ['content', 0, 'content', 0],
    ],
    [
      '清單項目不以段落開頭',
      doc({
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'horizontalRule' }] }],
      }),
      ['content', 0, 'content', 0, 'content', 0],
    ],
    ['空的引言', doc({ type: 'blockquote' }), ['content', 0, 'content']],
    [
      '程式碼區塊裡的文字有標記',
      doc({ type: 'codeBlock', content: [text('x', [{ type: 'bold' }])] }),
      ['content', 0, 'content', 0, 'marks'],
    ],
    ['空字串的文字', doc(paragraph(text(''))), ['content', 0, 'content', 0, 'text']],
    [
      '不支援的標記',
      doc(paragraph(text('x', [{ type: 'highlight' }]))),
      ['content', 0, 'content', 0, 'marks', 0],
    ],
    [
      '重複的標記',
      doc(paragraph(text('x', [{ type: 'bold' }, { type: 'bold' }]))),
      ['content', 0, 'content', 0, 'marks', 1],
    ],
    [
      '不安全的連結',
      doc(paragraph(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))),
      ['content', 0, 'content', 0, 'marks', 0, 'attrs', 'href'],
    ],
    [
      '標題層級 1',
      doc({ type: 'heading', attrs: { level: 1 }, content: [text('x')] }),
      ['content', 0, 'attrs', 'level'],
    ],
    ['巢狀的 doc', doc({ type: 'doc', content: [paragraph()] }), ['content', 0]],
  ])('%s', (_, document, path) => {
    expect(findRichTextIssue(document)?.path).toEqual(path);
  });

  it('巢狀超過上限', () => {
    let node: RichTextNode = paragraph(text('深'));
    for (let depth = 0; depth < 30; depth += 1) node = { type: 'blockquote', content: [node] };
    expect(findRichTextIssue(doc(node))?.message).toBe('巢狀超過 20 層');
    expect(findRichTextIssue(doc(node), { maxDepth: 40 })).toBeUndefined();
  });

  it('節點數超過上限', () => {
    const many = doc(...Array.from({ length: 10 }, () => paragraph(text('x'))));
    expect(findRichTextIssue(many, { maxNodes: 15 })?.message).toBe('節點超過 15 個');
  });
});

describe('createRichTextDocumentSchema（api 的 DTO 驗證）', () => {
  const schema = createRichTextDocumentSchema({ maxLength: 5, required: true });

  it('合法時回傳文件，多餘的欄位去掉', () => {
    const result = schema.safeParse({
      type: 'doc',
      content: [{ type: 'paragraph', extra: 1, content: [text('好')] }],
    });
    expect(result.success && result.data).toEqual(doc(paragraph(text('好'))));
  });

  it.each<[string, unknown, string]>([
    ['不是文件', 'plain text', ''],
    ['內容規則不合', doc(text('x')), 'doc 裡不能放 text'],
    ['必填但沒有字', doc({ type: 'paragraph' }), '內容不能是空的'],
    ['超過字數', doc(paragraph(text('一二三四五六'))), '內容超過 5 字'],
  ])('%s', (_, value, message) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    if (message) expect(result.error?.issues[0]?.message).toBe(message);
  });

  it('節點的 type 只接受白名單', () => {
    expect(RichTextNodeSchema.safeParse({ type: 'script' }).success).toBe(false);
  });
});

describe('isValidRichTextDocument（前端送出前的檢查）', () => {
  it('合法的文件通過、不合法的不通過', () => {
    expect(isValidRichTextDocument(doc(paragraph(text('x'))))).toBe(true);
    expect(isValidRichTextDocument(doc({ type: 'image' }))).toBe(false);
  });
});
