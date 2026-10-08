import { isTag, isText } from 'domhandler';
import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';

import { RICH_TEXT_HEADING_LEVELS } from './document.js';
import type { RichTextDocument, RichTextMark, RichTextNode } from './document.js';
import { isSafeLinkHref } from './link.js';

/*
 * HTML → 文件（`@b2b-system/rich-text/html`）：外部系統送來的 HTML、匯入。另成一個子路徑，
 * 只用到 JSON 的地方（前端的檢視器、api 的驗證）不會帶進 HTML 解析器（htmlparser2，不需要 DOM，Node 與瀏覽器都能跑）。
 */

/** 整個丟掉（連同裡面的文字）的元素。 */
const DROPPED = new Set([
  'script',
  'style',
  'template',
  'iframe',
  'object',
  'embed',
  'noscript',
  'head',
  'title',
  'meta',
  'link',
  'svg',
  'math',
  'canvas',
  'video',
  'audio',
  'button',
  'input',
  'select',
  'textarea',
]);

/** 當成區塊容器的元素：裡面的內容照常解析，前後斷開段落。 */
const BLOCK_CONTAINERS = new Set([
  'html',
  'body',
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'figure',
  'figcaption',
  'address',
  'details',
  'summary',
  'fieldset',
  'form',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
]);

const MARK_OF_TAG: Record<string, RichTextMark['type']> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  ins: 'underline',
  s: 'strike',
  strike: 'strike',
  del: 'strike',
  code: 'code',
  kbd: 'code',
  samp: 'code',
};

/** HTML 的空白（不含 `&nbsp;`：瀏覽器不會合併它）。 */
const HTML_WHITESPACE = /[ \t\n\r\f]+/g;

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * HTML 轉成文件：只留下白名單的節點與標記（與編輯器的 schema 相同），其餘元素保留裡面的文字，
 * `<script>`、`<style>` 等連同內容丟掉。h1、h2 → 標題 2，h3～h6 → 標題 3；連結只留 `isSafeLinkHref` 的網址；
 * 段落裡的空白依 HTML 的規則合併，`<pre>` 保留。結果一定通過 `findRichTextIssue`（空的 HTML 得到一個空段落）。
 */
export function htmlToRichText(html: string): RichTextDocument {
  const dom = parseDocument(html, { decodeEntities: true });
  const content = parseBlocks(dom.children);
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

/** 一串節點解析成區塊：連續的行內內容收成一個段落。 */
function parseBlocks(nodes: readonly ChildNode[]): RichTextNode[] {
  const blocks: RichTextNode[] = [];
  let inline: RichTextNode[] = [];
  const flush = () => {
    const trimmed = trimInline(inline);
    if (trimmed.length > 0) blocks.push({ type: 'paragraph', content: trimmed });
    inline = [];
  };
  for (const node of nodes) {
    const block = isTag(node) ? parseBlockElement(node) : undefined;
    if (block) {
      flush();
      blocks.push(...block);
    } else {
      inline.push(...parseInline(node, []));
    }
  }
  flush();
  return blocks;
}

/** 區塊元素轉成區塊；行內元素回傳 `undefined`（交給 `parseInline`）。 */
function parseBlockElement(element: Element): RichTextNode[] | undefined {
  const tag = element.name.toLowerCase();
  if (DROPPED.has(tag)) return [];
  if (tag === 'p') return paragraphOf(inlineOf(element.children));
  if (HEADING_TAGS.has(tag)) {
    const level =
      tag === 'h1' || tag === 'h2' ? RICH_TEXT_HEADING_LEVELS[0] : RICH_TEXT_HEADING_LEVELS[1];
    const content = trimInline(inlineOf(element.children));
    return [{ type: 'heading', attrs: { level }, ...(content.length > 0 ? { content } : {}) }];
  }
  if (tag === 'ul' || tag === 'ol') return listOf(element, tag);
  if (tag === 'li') return listOf(element, 'ul');
  if (tag === 'blockquote') {
    const content = parseBlocks(element.children);
    return content.length > 0 ? [{ type: 'blockquote', content }] : [];
  }
  if (tag === 'pre') {
    const text = textOf(element).replace(/\n$/, '');
    return [{ type: 'codeBlock', ...(text ? { content: [{ type: 'text', text }] } : {}) }];
  }
  if (tag === 'hr') return [{ type: 'horizontalRule' }];
  if (BLOCK_CONTAINERS.has(tag)) return parseBlocks(element.children);
  return undefined;
}

function listOf(element: Element, tag: 'ul' | 'ol'): RichTextNode[] {
  const items: RichTextNode[] = [];
  // `<ul>` 裡直接放的文字或元素（不在 `<li>` 裡）也收成一項
  let loose: ChildNode[] = [];
  const pushItem = (children: readonly ChildNode[]) => {
    const content = parseBlocks(children);
    if (content.length === 0) return;
    // 清單項目的第一個子節點必須是段落
    if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' });
    items.push({ type: 'listItem', content });
  };
  const source = element.name.toLowerCase() === 'li' ? [element] : element.children;
  for (const child of source) {
    if (isTag(child) && child.name.toLowerCase() === 'li') {
      if (loose.length > 0) pushItem(loose);
      loose = [];
      pushItem(child.children);
    } else {
      loose.push(child);
    }
  }
  if (loose.length > 0) pushItem(loose);
  if (items.length === 0) return [];
  const start = Number(element.attribs.start);
  const attrs =
    tag === 'ol' && Number.isInteger(start) && start >= 0 && start !== 1 ? { start } : undefined;
  return [
    {
      type: tag === 'ol' ? 'orderedList' : 'bulletList',
      ...(attrs ? { attrs } : {}),
      content: items,
    },
  ];
}

/** 明寫的 `<p>` 即使是空的也保留（空行）：`richTextToHtml` 輸出的空段落轉回來才會相同。 */
function paragraphOf(inline: RichTextNode[]): RichTextNode[] {
  const content = trimInline(inline);
  return [{ type: 'paragraph', ...(content.length > 0 ? { content } : {}) }];
}

function inlineOf(nodes: readonly ChildNode[]): RichTextNode[] {
  return nodes.flatMap((node) => parseInline(node, []));
}

/** 行內內容：文字（帶目前的標記）與 `<br>`；區塊元素出現在行內位置時只取文字。 */
function parseInline(node: ChildNode, marks: readonly RichTextMark[]): RichTextNode[] {
  if (isText(node)) {
    const text = node.data.replace(HTML_WHITESPACE, ' ');
    return text ? [{ type: 'text', text, ...(marks.length > 0 ? { marks: [...marks] } : {}) }] : [];
  }
  // 註解、處理指令等：沒有內容
  if (!isTag(node)) return [];
  const element = node;
  const tag = element.name.toLowerCase();
  if (DROPPED.has(tag)) return [];
  if (tag === 'br') return [{ type: 'hardBreak' }];
  const next = withMark(marks, tag, element);
  return element.children.flatMap((child) => parseInline(child, next));
}

function withMark(
  marks: readonly RichTextMark[],
  tag: string,
  element: Element,
): readonly RichTextMark[] {
  if (tag === 'a') {
    const href = element.attribs.href?.trim();
    if (!isSafeLinkHref(href) || marks.some((mark) => mark.type === 'link')) return marks;
    return [...marks, { type: 'link', attrs: { href } }];
  }
  const type = MARK_OF_TAG[tag];
  if (!type || marks.some((mark) => mark.type === type)) return marks;
  return [...marks, { type }];
}

/** 相鄰且標記相同的文字合併；段落頭尾、`<br>` 前後的空白拿掉，跨元素的連續空白只留一個。 */
function trimInline(nodes: RichTextNode[]): RichTextNode[] {
  const result: RichTextNode[] = [];
  for (const node of nodes) {
    if (node.type !== 'text') {
      trimEnd(result);
      result.push({ ...node });
      continue;
    }
    const previous = result.at(-1);
    let text = node.text ?? '';
    if (!previous || previous.type !== 'text' || previous.text?.endsWith(' ')) {
      text = text.replace(/^ +/, '');
    }
    if (text === '') continue;
    if (previous?.type === 'text' && sameMarks(previous, node)) {
      result[result.length - 1] = { ...previous, text: `${previous.text ?? ''}${text}` };
    } else {
      result.push({ ...node, text });
    }
  }
  trimEnd(result);
  return result;
}

/** 拿掉尾端文字的空白；拿完是空字串的文字節點整個移除。 */
function trimEnd(nodes: RichTextNode[]): void {
  for (let last = nodes.at(-1); last?.type === 'text'; last = nodes.at(-1)) {
    const text = (last.text ?? '').replace(/ +$/, '');
    if (text !== '') {
      nodes[nodes.length - 1] = { ...last, text };
      return;
    }
    nodes.pop();
  }
}

function sameMarks(a: RichTextNode, b: RichTextNode): boolean {
  const left = a.marks ?? [];
  const right = b.marks ?? [];
  return (
    left.length === right.length &&
    left.every((mark, index) => {
      const other = right[index];
      return other?.type === mark.type && other.attrs?.href === mark.attrs?.href;
    })
  );
}

/** `<pre>` 的原始文字（不合併空白；`<br>` 換行）。 */
function textOf(node: ChildNode): string {
  if (isText(node)) return node.data;
  if (!isTag(node)) return '';
  if (node.name.toLowerCase() === 'br') return '\n';
  return node.children.map(textOf).join('');
}
