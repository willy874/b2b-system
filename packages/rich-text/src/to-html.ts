import type { RichTextMark, RichTextNode } from './document.js';
import { isSafeLinkHref } from './link.js';
import { richTextToPlainText } from './plain-text.js';

/** 超過這個深度的節點只輸出純文字（與 `RichTextViewer` 相同）。 */
const MAX_DEPTH = 32;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

const HEADING_TAG = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const;

/**
 * 文件轉成 HTML 字串（Email、對外 API、Webhook 用）。不需要 DOM，Node 與瀏覽器都能跑。
 * 只輸出白名單的元素；文字與屬性一律跳脫；連結只輸出 `isSafeLinkHref` 的網址（`rel="noopener noreferrer nofollow"`），
 * 其餘只留文字；認不得的節點輸出裡面的內容。合法的文件經 `htmlToRichText` 轉回來得到相同的文件，
 * 只有段落裡連續的空白會依 HTML 的規則合併成一個（程式碼區塊保留）。
 */
export function richTextToHtml(document: RichTextNode | null | undefined): string {
  return document ? renderChildren(document, 0) : '';
}

function renderChildren(node: RichTextNode, depth: number): string {
  return (node.content ?? []).map((child) => renderNode(child, depth + 1)).join('');
}

function renderNode(node: RichTextNode, depth: number): string {
  if (node.type === 'text') return renderText(node);
  if (depth > MAX_DEPTH) return escapeHtml(richTextToPlainText(node));
  const children = renderChildren(node, depth);
  switch (node.type) {
    case 'paragraph':
      return `<p>${children}</p>`;
    case 'heading': {
      const tag = HEADING_TAG[headingLevel(node.attrs?.level)];
      return `<${tag}>${children}</${tag}>`;
    }
    case 'bulletList':
      return `<ul>${children}</ul>`;
    case 'orderedList': {
      const start = node.attrs?.start;
      const attribute =
        typeof start === 'number' && Number.isInteger(start) && start !== 1
          ? ` start="${start}"`
          : '';
      return `<ol${attribute}>${children}</ol>`;
    }
    case 'listItem':
      return `<li>${children}</li>`;
    case 'blockquote':
      return `<blockquote>${children}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${escapeHtml(richTextToPlainText(node))}</code></pre>`;
    case 'horizontalRule':
      return '<hr>';
    case 'hardBreak':
      return '<br>';
    default:
      return children;
  }
}

function headingLevel(level: unknown): keyof typeof HEADING_TAG {
  return level === 1 || level === 3 || level === 4 || level === 5 || level === 6 ? level : 2;
}

/** 標記由外往內包：`marks[0]` 在最外層。 */
function renderText(node: RichTextNode): string {
  const marks = node.marks ?? [];
  let html = escapeHtml(node.text ?? '');
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index];
    if (mark) html = renderMark(mark, html);
  }
  return html;
}

function renderMark(mark: RichTextMark, html: string): string {
  switch (mark.type) {
    case 'bold':
      return `<strong>${html}</strong>`;
    case 'italic':
      return `<em>${html}</em>`;
    case 'underline':
      return `<u>${html}</u>`;
    case 'strike':
      return `<s>${html}</s>`;
    case 'code':
      return `<code>${html}</code>`;
    case 'link': {
      const href = mark.attrs?.href;
      if (!isSafeLinkHref(href)) return html;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${html}</a>`;
    }
    default:
      return html;
  }
}
