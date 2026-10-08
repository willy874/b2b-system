import { RICH_TEXT_FORMATS } from '@b2b-system/rich-text';
import type { RichTextDocument, RichTextFormat, RichTextNode } from '@b2b-system/rich-text';
import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { fitToSchema } from './fitToSchema';
import { createRichTextExtensions } from './richTextExtensions';

const schemaOf = (formats: readonly RichTextFormat[]) =>
  getSchema(
    createRichTextExtensions({
      formats: new Set(formats),
      maxLength: undefined,
      onLinkShortcut: () => {},
    }),
  );

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: RichTextNode[]): RichTextNode => ({ type: 'paragraph', content });
const doc = (...content: RichTextNode[]): RichTextDocument => ({ type: 'doc', content });

describe('fitToSchema（內容整理成編輯器接受的形狀，不讓既有內容消失）', () => {
  it('全部格式開放時原樣保留', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('標題', [{ type: 'bold' }])] },
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [paragraph(text('項目'))] }],
      },
    );
    expect(fitToSchema(value, schemaOf(RICH_TEXT_FORMATS)).toJSON()).toMatchObject(value);
  });

  it.each<[string, RichTextDocument, RichTextDocument]>([
    [
      '沒開放的標記拿掉、文字保留',
      doc(paragraph(text('粗', [{ type: 'bold' }]), text('斜', [{ type: 'italic' }]))),
      doc(paragraph(text('粗', [{ type: 'bold' }]), text('斜'))),
    ],
    [
      '沒開放的標題變成段落',
      doc({ type: 'heading', attrs: { level: 2 }, content: [text('標題')] }),
      doc(paragraph(text('標題'))),
    ],
    [
      '沒開放的清單：每一項變成段落',
      doc({
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [paragraph(text('一'))] },
          { type: 'listItem', content: [paragraph(text('二'))] },
        ],
      }),
      doc(paragraph(text('一')), paragraph(text('二'))),
    ],
    [
      '認不得的行內節點以內容取代',
      doc(paragraph(text('嗨 '), { type: 'mention', content: [text('@某人')] })),
      // 相鄰、標記相同的文字由 ProseMirror 合併
      doc(paragraph(text('嗨 @某人'))),
    ],
  ])('%s', (_, value, expected) => {
    expect(fitToSchema(value, schemaOf(['bold'])).toJSON()).toEqual(expected);
  });

  it('空文件補成一個空段落', () => {
    expect(fitToSchema(doc(), schemaOf(['bold'])).toJSON()).toEqual(doc({ type: 'paragraph' }));
  });

  it('整理後仍不合法（空的引言）時退回純文字段落', () => {
    const value = doc(paragraph(text('前')), { type: 'blockquote' }, paragraph(text('後')));
    expect(fitToSchema(value, schemaOf(['blockquote'])).toJSON()).toEqual(
      doc(paragraph(text('前')), paragraph(text('後'))),
    );
  });
});
