import { describe, expect, it } from 'vitest';

import {
  EMPTY_RICH_TEXT_DOCUMENT,
  isRichTextEmpty,
  isSafeLinkHref,
  normalizeLinkHref,
  richTextToPlainText,
} from '../index';
import type { RichTextDocument, RichTextNode } from '../index';

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: RichTextNode[]): RichTextNode => ({ type: 'paragraph', content });
const doc = (...content: RichTextNode[]): RichTextDocument => ({ type: 'doc', content });

describe('richTextToPlainText', () => {
  it.each<[string, RichTextDocument, string]>([
    ['空文件', EMPTY_RICH_TEXT_DOCUMENT, ''],
    ['段落之間換行', doc(paragraph(text('甲')), paragraph(text('乙'))), '甲\n乙'],
    [
      '標記只留文字，連結的網址不輸出',
      doc(
        paragraph(
          text('看 '),
          text('這裡', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
          text('，很', []),
          text('重要', [{ type: 'bold' }]),
        ),
      ),
      '看 這裡，很重要',
    ],
    [
      'hardBreak 換行',
      doc(paragraph(text('第一行'), { type: 'hardBreak' }, text('第二行'))),
      '第一行\n第二行',
    ],
    [
      '清單的每一項各自一行',
      doc(
        paragraph(text('步驟：')),
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [paragraph(text('一'))] },
            {
              type: 'listItem',
              content: [
                paragraph(text('二')),
                {
                  type: 'bulletList',
                  content: [{ type: 'listItem', content: [paragraph(text('二之一'))] }],
                },
              ],
            },
          ],
        },
        paragraph(text('完')),
      ),
      '步驟：\n一\n二\n二之一\n完',
    ],
    ['空段落不輸出空行', doc(paragraph(text('甲')), paragraph(), paragraph(text('乙'))), '甲\n乙'],
  ])('%s', (_, document, expected) => {
    expect(richTextToPlainText(document)).toBe(expected);
  });

  it('沒有值時是空字串', () => {
    expect(richTextToPlainText(undefined)).toBe('');
    expect(richTextToPlainText(null)).toBe('');
  });

  it('很深的巢狀也不會爆掉堆疊（迴圈走訪）', () => {
    let node: RichTextNode = paragraph(text('最裡面'));
    for (let depth = 0; depth < 20_000; depth += 1) node = { type: 'blockquote', content: [node] };
    expect(richTextToPlainText(doc(node))).toBe('最裡面');
  });
});

describe('isRichTextEmpty', () => {
  it.each<[string, RichTextDocument | undefined, boolean]>([
    ['空文件', EMPTY_RICH_TEXT_DOCUMENT, true],
    ['沒有值', undefined, true],
    ['只有空白', doc(paragraph(text('  ')), paragraph()), true],
    ['只有分隔線', doc({ type: 'horizontalRule' }), true],
    ['有文字', doc(paragraph(text('內容'))), false],
  ])('%s → %s', (_, document, expected) => {
    expect(isRichTextEmpty(document)).toBe(expected);
  });
});

describe('isSafeLinkHref（連結只接受 http、https、mailto 與站內路徑）', () => {
  it.each([
    'https://example.com/a?b=1#c',
    'http://example.com',
    'mailto:someone@example.com',
    '/settings/profile',
  ])('接受 %s', (href) => {
    expect(isSafeLinkHref(href)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'ftp://example.com',
    '//evil.example.com',
    '/\\evil.example.com',
    'example.com',
    ' https://example.com',
    '',
    42,
    undefined,
  ])('拒絕 %s', (href) => {
    expect(isSafeLinkHref(href)).toBe(false);
  });
});

describe('normalizeLinkHref', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  example.com/path ', 'https://example.com/path'],
    ['http://example.com', 'http://example.com'],
    ['mailto:a@example.com', 'mailto:a@example.com'],
    ['/inside', '/inside'],
    ['javascript:alert(1)', 'javascript:alert(1)'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeLinkHref(input)).toBe(expected);
  });
});
