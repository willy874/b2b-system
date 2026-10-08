import type { RichTextNode } from './document.js';

/** 走訪時標記「這個區塊結束了」。 */
const BLOCK_END = Symbol('blockEnd');

/** 純文字裡自成一行的節點（容器本身不是一行，但它前後要斷行）。 */
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'bulletList',
  'orderedList',
]);

/**
 * 取出純文字：通知的摘要、搜尋、字數上限都用它。區塊之間換行，`hardBreak` 也換行；
 * 標記（粗體、連結）只留文字，連結的網址不輸出。迴圈走訪，不遞迴（內容來自外部，不讓深度爆掉堆疊）。
 */
export function richTextToPlainText(document: RichTextNode | null | undefined): string {
  if (!document) return '';
  const blocks: string[] = [];
  let line = '';
  const stack: Array<RichTextNode | typeof BLOCK_END> = [document];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node === BLOCK_END) {
      if (line !== '') blocks.push(line);
      line = '';
      continue;
    }
    if (node.type === 'text') {
      line += node.text ?? '';
      continue;
    }
    if (node.type === 'hardBreak') {
      line += '\n';
      continue;
    }
    if (BLOCK_TYPES.has(node.type)) {
      if (line !== '') blocks.push(line);
      line = '';
      stack.push(BLOCK_END);
    }
    const children = node.content ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) stack.push(child);
    }
  }
  if (line !== '') blocks.push(line);
  return blocks.join('\n');
}

/** 沒有任何文字（只有空段落、分隔線也算空）：必填檢查用它，不要比對 JSON。 */
export function isRichTextEmpty(document: RichTextNode | null | undefined): boolean {
  return richTextToPlainText(document).trim() === '';
}
