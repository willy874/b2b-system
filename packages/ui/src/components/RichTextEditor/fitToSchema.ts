import { richTextToPlainText } from '@b2b-system/rich-text';
import type { RichTextDocument, RichTextNode } from '@b2b-system/rich-text';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

/**
 * 把文件轉成這個編輯器的 schema 接受的節點：認不得的標記拿掉、認不得的節點以它的內容取代
 * （清單 → 段落、標題 → 段落裡的文字），散在區塊位置的行內內容包成段落。
 *
 * Tiptap 遇到不合 schema 的 JSON 會整份換成空文件（只在 console 警告），而 `formats` 關掉某個格式、
 * 或資料來自較新的版本時就會發生；這裡先整理，連整理後都不合法時退回純文字段落，**不讓既有內容消失**。
 */
export function fitToSchema(document: RichTextDocument, schema: Schema): ProseMirrorNode {
  try {
    const node = schema.nodeFromJSON({
      type: 'doc',
      content: wrapInline(fitChildren(document, schema), schema),
    });
    node.check();
    return node;
  } catch {
    // 整理後仍不合法（例如屬性的值不對）：只保留文字，每行一個段落
    return schema.nodeFromJSON(plainTextDocument(richTextToPlainText(document)));
  }
}

function fitChildren(node: RichTextNode, schema: Schema): RichTextNode[] {
  return (node.content ?? []).flatMap((child) => fitNode(child, schema));
}

function fitNode(node: RichTextNode, schema: Schema): RichTextNode[] {
  const marks = node.marks?.filter((mark) => mark.type in schema.marks);
  if (node.type === 'text') {
    if (!node.text) return [];
    return [{ type: 'text', text: node.text, ...(marks?.length ? { marks } : {}) }];
  }
  const nodeType = schema.nodes[node.type];
  const children = fitChildren(node, schema);
  // 認不得的節點：以內容取代（行內內容稍後由上一層包成段落）
  if (!nodeType) return children;
  const content = nodeType.isTextblock ? children : wrapInline(children, schema);
  return [
    {
      type: node.type,
      ...(node.attrs ? { attrs: node.attrs } : {}),
      ...(content.length > 0 ? { content } : {}),
      ...(marks?.length ? { marks } : {}),
    },
  ];
}

/** 區塊容器（doc、引言、清單項目）裡連續的行內節點包成一個段落。 */
function wrapInline(nodes: RichTextNode[], schema: Schema): RichTextNode[] {
  const result: RichTextNode[] = [];
  let inline: RichTextNode[] = [];
  const flush = () => {
    if (inline.length > 0) result.push({ type: 'paragraph', content: inline });
    inline = [];
  };
  for (const node of nodes) {
    if (schema.nodes[node.type]?.isInline) {
      inline.push(node);
    } else {
      flush();
      result.push(node);
    }
  }
  flush();
  return result;
}

function plainTextDocument(text: string): RichTextDocument {
  const lines = text.split('\n');
  return {
    type: 'doc',
    content: lines.map((line) =>
      line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' },
    ),
  };
}
