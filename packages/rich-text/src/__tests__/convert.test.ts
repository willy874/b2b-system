import { describe, expect, it } from 'vitest';

import { htmlToRichText } from '../html';
import { findRichTextIssue, plainTextToRichText, richTextToHtml } from '../index';
import type { RichTextDocument, RichTextNode } from '../index';

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: RichTextNode[]): RichTextNode =>
  content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
const doc = (...content: RichTextNode[]): RichTextDocument => ({ type: 'doc', content });
const link = (href: string) => ({ type: 'link', attrs: { href } });

/** 每種節點與標記都出現一次的文件。 */
const FULL = doc(
  { type: 'heading', attrs: { level: 2 }, content: [text('標題')] },
  paragraph(
    text('一般 '),
    text('粗', [{ type: 'bold' }]),
    text('斜', [{ type: 'italic' }]),
    text('底', [{ type: 'underline' }]),
    text('刪', [{ type: 'strike' }]),
    text('碼', [{ type: 'code' }]),
    text('連結', [link('https://example.com/?a=1&b=2')]),
    text('粗斜', [{ type: 'bold' }, { type: 'italic' }]),
    { type: 'hardBreak' },
    text('第二行'),
  ),
  { type: 'heading', attrs: { level: 3 }, content: [text('小標題')] },
  {
    type: 'orderedList',
    attrs: { start: 3 },
    content: [
      { type: 'listItem', content: [paragraph(text('三'))] },
      {
        type: 'listItem',
        content: [
          paragraph(text('四')),
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [paragraph(text('四之一'))] }],
          },
        ],
      },
    ],
  },
  { type: 'blockquote', content: [paragraph(text('引言'))] },
  { type: 'codeBlock', content: [text('if (a < b) {\n  return "x";\n}')] },
  { type: 'horizontalRule' },
  paragraph(),
  paragraph(text('完')),
);

describe('richTextToHtml', () => {
  it('每種節點與標記輸出成對應的元素，文字與屬性跳脫', () => {
    expect(richTextToHtml(FULL)).toBe(
      [
        '<h2>標題</h2>',
        '<p>一般 <strong>粗</strong><em>斜</em><u>底</u><s>刪</s><code>碼</code>',
        '<a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">連結</a>',
        '<strong><em>粗斜</em></strong><br>第二行</p>',
        '<h3>小標題</h3>',
        '<ol start="3"><li><p>三</p></li><li><p>四</p><ul><li><p>四之一</p></li></ul></li></ol>',
        '<blockquote><p>引言</p></blockquote>',
        '<pre><code>if (a &lt; b) {\n  return &quot;x&quot;;\n}</code></pre>',
        '<hr><p></p><p>完</p>',
      ].join(''),
    );
  });

  it('文字裡的 HTML 跳脫，不會變成標籤', () => {
    expect(richTextToHtml(doc(paragraph(text('<img src=x onerror=alert(1)>'))))).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    );
  });

  it('不安全的連結只輸出文字', () => {
    expect(richTextToHtml(doc(paragraph(text('點我', [link('javascript:alert(1)')]))))).toBe(
      '<p>點我</p>',
    );
  });

  it('認不得的節點輸出內容、認不得的標記忽略', () => {
    expect(
      richTextToHtml(
        doc({ type: 'mention', content: [text('@某人', [{ type: 'highlight' }])] }, paragraph()),
      ),
    ).toBe('@某人<p></p>');
  });

  it('沒有值時是空字串', () => {
    expect(richTextToHtml(undefined)).toBe('');
  });
});

describe('htmlToRichText', () => {
  it('richTextToHtml 的輸出轉回來得到相同的文件（連結只留 href）', () => {
    expect(htmlToRichText(richTextToHtml(FULL))).toEqual(FULL);
  });

  it.each<[string, string, RichTextDocument]>([
    ['空字串得到一個空段落', '', doc(paragraph())],
    [
      '沒有包在段落裡的文字成為段落',
      'hello <b>world</b>',
      doc(paragraph(text('hello '), text('world', [{ type: 'bold' }]))),
    ],
    [
      '空白依 HTML 規則合併，段落頭尾的空白拿掉',
      '<p>\n   a   b\n  <em> c </em>  </p>',
      doc(paragraph(text('a b '), text('c', [{ type: 'italic' }]))),
    ],
    [
      'b／i／del／ins／kbd 對應到標記，重複的標記只留一個',
      '<p><b>粗<strong>還是粗</strong></b><i>斜</i><del>刪</del><ins>底</ins><kbd>鍵</kbd></p>',
      doc(
        paragraph(
          text('粗還是粗', [{ type: 'bold' }]),
          text('斜', [{ type: 'italic' }]),
          text('刪', [{ type: 'strike' }]),
          text('底', [{ type: 'underline' }]),
          text('鍵', [{ type: 'code' }]),
        ),
      ),
    ],
    [
      'h1 與 h2 成為標題 2，h4 成為標題 3',
      '<h1>一</h1><h4>四</h4>',
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('一')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('四')] },
      ),
    ],
    [
      'script、style 連同內容丟掉；事件屬性不會留下',
      '<p onclick="x()">安全</p><script>alert(1)</script><style>p{}</style>',
      doc(paragraph(text('安全'))),
    ],
    [
      '不安全的連結只留文字',
      '<p><a href="javascript:alert(1)">點我</a> <a href="data:text/html,x">也是</a></p>',
      doc(paragraph(text('點我 也是'))),
    ],
    [
      'div、table 等容器拆成段落，span 只留文字',
      '<div><span style="color:red">紅</span>字</div><table><tr><td>格</td></tr></table>',
      doc(paragraph(text('紅字')), paragraph(text('格'))),
    ],
    [
      '圖片與表單元素丟掉',
      '<p>前<img src="x.png" alt="圖"><input value="v">後</p>',
      doc(paragraph(text('前後'))),
    ],
    [
      '清單項目裡直接放文字時補成段落；以標題開頭時前面補空段落',
      '<ul><li>一</li><li><h2>二</h2></li></ul>',
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('一'))] },
          {
            type: 'listItem',
            content: [paragraph(), { type: 'heading', attrs: { level: 2 }, content: [text('二')] }],
          },
        ],
      }),
    ],
    [
      'pre 保留空白與換行，<br> 在 pre 裡是換行',
      '<pre>  a\n    b<br>c\n</pre>',
      doc({ type: 'codeBlock', content: [text('  a\n    b\nc')] }),
    ],
    ['實體解碼', '<p>A &amp; B &lt;C&gt; &nbsp;D</p>', doc(paragraph(text('A & B <C>  D')))],
  ])('%s', (_, html, expected) => {
    expect(htmlToRichText(html)).toEqual(expected);
  });

  it.each([
    '<ul><li><ul><li>巢狀</li></ul></li></ul>',
    '<blockquote>直接的文字<p>段落</p></blockquote>',
    '<ol start="5"><li></li><li>x</li></ol>',
    '<p><b><i><u><s><code><a href="/x">全部</a></code></s></u></i></b></p>',
    '<h2></h2><pre></pre><hr><hr>',
    '<li>沒有 ul 的 li</li>',
    '<<<>>> <p unclosed',
  ])('結果一定通過內容規則：%s', (html) => {
    expect(findRichTextIssue(htmlToRichText(html))).toBeUndefined();
  });
});

describe('plainTextToRichText', () => {
  it('每一行一個段落，空行是空段落', () => {
    expect(plainTextToRichText('第一行\r\n\n第三行')).toEqual(
      doc(paragraph(text('第一行')), paragraph(), paragraph(text('第三行'))),
    );
  });

  it('結果通過內容規則', () => {
    expect(findRichTextIssue(plainTextToRichText(''))).toBeUndefined();
  });
});
