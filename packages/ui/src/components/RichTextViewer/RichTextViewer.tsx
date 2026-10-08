import { isSafeLinkHref, richTextToPlainText } from '@b2b-system/rich-text';
import type { RichTextMark, RichTextNode } from '@b2b-system/rich-text';
import { cn } from '@b2b-system/web-shared/utils';
import type { CSSProperties, ReactNode, Ref } from 'react';

import content from './richTextContent.module.css';

export interface RichTextViewerProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 要顯示的文件（`RichTextEditor` 回報的 JSON）；沒有值時不渲染任何內容。 */
  value: RichTextNode | null | undefined;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'data-testid'?: string;
}

/**
 * 超過這個深度的節點只顯示純文字：內容來自資料庫，被改成極深的巢狀時不讓渲染爆掉堆疊。
 * 編輯器做得出來的文件（清單裡的清單、引言裡的清單）遠低於這個深度。
 */
const MAX_DEPTH = 32;

const HEADING_TAG = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const;

/**
 * 唯讀顯示富文本。自己把 JSON 轉成 React 元素，**不載入編輯器**（Tiptap／ProseMirror），也不用 `innerHTML`：
 * 只認得 `RichTextEditor` 產生的節點與標記，認不得的節點只顯示裡面的文字；連結只接受 `isSafeLinkHref` 的網址。
 * 排版與編輯器的編輯區共用 `richTextContent.module.css`（docs/architecture/frontend/07-ui-system.md §3.16）。
 */
export function RichTextViewer({ value, className, ...rest }: RichTextViewerProps) {
  return (
    <div className={cn(content.content, className)} {...rest}>
      {value ? renderChildren(value, 0) : null}
    </div>
  );
}

function renderChildren(node: RichTextNode, depth: number): ReactNode {
  return node.content?.map((child, index) => renderNode(child, depth + 1, index));
}

function renderNode(node: RichTextNode, depth: number, key: number): ReactNode {
  if (node.type === 'text') return renderText(node, key);
  if (depth > MAX_DEPTH) return <span key={key}>{richTextToPlainText(node)}</span>;
  const children = renderChildren(node, depth);
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'heading': {
      const Tag = HEADING_TAG[headingLevel(node.attrs?.level)];
      return <Tag key={key}>{children}</Tag>;
    }
    case 'bulletList':
      return <ul key={key}>{children}</ul>;
    case 'orderedList': {
      const start = node.attrs?.start;
      return (
        <ol key={key} start={typeof start === 'number' && start !== 1 ? start : undefined}>
          {children}
        </ol>
      );
    }
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{richTextToPlainText(node)}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    case 'hardBreak':
      return <br key={key} />;
    default:
      // 認不得的節點（之後新增的格式、被改過的資料）：保留裡面的內容，不丟掉文字
      return <span key={key}>{children}</span>;
  }
}

function headingLevel(level: unknown): keyof typeof HEADING_TAG {
  return level === 1 || level === 3 || level === 4 || level === 5 || level === 6 ? level : 2;
}

/** 標記由外往內包：`marks[0]` 在最外層。 */
function renderText(node: RichTextNode, key: number): ReactNode {
  const marks = node.marks ?? [];
  let element: ReactNode = node.text ?? '';
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index];
    if (mark) element = renderMark(mark, element);
  }
  return <span key={key}>{element}</span>;
}

function renderMark(mark: RichTextMark, children: ReactNode): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong>{children}</strong>;
    case 'italic':
      return <em>{children}</em>;
    case 'underline':
      return <u>{children}</u>;
    case 'strike':
      return <s>{children}</s>;
    case 'code':
      return <code>{children}</code>;
    case 'link': {
      const href = mark.attrs?.href;
      // 不安全的網址（`javascript:` 等）只顯示文字
      if (!isSafeLinkHref(href)) return children;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow">
          {children}
        </a>
      );
    }
    default:
      return children;
  }
}
