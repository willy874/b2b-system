import { RICH_TEXT_HEADING_LEVELS, RICH_TEXT_MARK_TYPES } from './document.js';
import type {
  RichTextDocument,
  RichTextMark,
  RichTextMarkType,
  RichTextNode,
  RichTextNodeType,
} from './document.js';
import { isSafeLinkHref } from './link.js';

/** 驗證的上限：內容來自外部（API、匯入），不讓過大或過深的文件進到資料庫與編輯器。 */
export interface RichTextLimits {
  /** 巢狀深度上限（`doc` 是 0）。預設 20。 */
  maxDepth?: number;
  /** 節點總數上限（含文字節點）。預設 5000。 */
  maxNodes?: number;
}

/** 通過內容規則的標記：`type` 是白名單內的值（與 api 的 OpenAPI 型別相同）。 */
export interface ValidRichTextMark extends RichTextMark {
  type: RichTextMarkType;
}

/** 通過內容規則的節點。 */
export interface ValidRichTextNode extends RichTextNode {
  type: RichTextNodeType;
  content?: ValidRichTextNode[];
  marks?: ValidRichTextMark[];
}

/** 通過內容規則的文件：可以直接當成 API 的請求內容（`@b2b-system/api-sdk` 的 `RichTextDocument`）。 */
export interface ValidRichTextDocument extends RichTextDocument {
  content: ValidRichTextNode[];
}

export interface RichTextIssue {
  /** 出錯的節點在文件裡的位置，例如 `['content', 0, 'content', 1]`。 */
  path: Array<string | number>;
  message: string;
}

const DEFAULT_MAX_DEPTH = 20;
const DEFAULT_MAX_NODES = 5000;

const BLOCKS = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
]);
const INLINES = new Set(['text', 'hardBreak']);
const TEXT_ONLY = new Set(['text']);
const LIST_ITEMS = new Set(['listItem']);
const NOTHING = new Set<string>();

interface ContentRule {
  allowed: ReadonlySet<string>;
  /** ProseMirror 的 `block+`：至少一個子節點。 */
  nonEmpty?: boolean;
  /** 清單項目的 `paragraph block*`：第一個子節點必須是段落。 */
  firstParagraph?: boolean;
  /** 程式碼區塊的 `marks: ''`：裡面的文字不能有標記。 */
  noMarks?: boolean;
}

/** 與編輯器的 schema（Tiptap StarterKit）相同的內容規則。 */
const CONTENT_RULES: Record<string, ContentRule> = {
  doc: { allowed: BLOCKS, nonEmpty: true },
  paragraph: { allowed: INLINES },
  heading: { allowed: INLINES },
  codeBlock: { allowed: TEXT_ONLY, noMarks: true },
  blockquote: { allowed: BLOCKS, nonEmpty: true },
  bulletList: { allowed: LIST_ITEMS, nonEmpty: true },
  orderedList: { allowed: LIST_ITEMS, nonEmpty: true },
  listItem: { allowed: BLOCKS, nonEmpty: true, firstParagraph: true },
  horizontalRule: { allowed: NOTHING },
  hardBreak: { allowed: NOTHING },
  text: { allowed: NOTHING },
};

const MARK_TYPES = new Set<string>(RICH_TEXT_MARK_TYPES);
const HEADING_LEVELS = new Set<unknown>(RICH_TEXT_HEADING_LEVELS);

/**
 * 檢查文件是否合乎編輯器的 schema：節點與標記只能是白名單內的、父子關係正確、標題層級、
 * 連結網址（`isSafeLinkHref`）、深度與節點數。回傳第一個問題；合法時回傳 `undefined`。
 * 迴圈走訪，不遞迴。結構（欄位型別）由呼叫端先驗過（例：`@b2b-system/rich-text/schema`）。
 */
export function findRichTextIssue(
  document: RichTextNode,
  { maxDepth = DEFAULT_MAX_DEPTH, maxNodes = DEFAULT_MAX_NODES }: RichTextLimits = {},
): RichTextIssue | undefined {
  if (document.type !== 'doc') return { path: ['type'], message: '根節點必須是 doc' };
  const stack: Array<{ node: RichTextNode; path: Array<string | number>; depth: number }> = [
    { node: document, path: [], depth: 0 },
  ];
  let count = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const { node, path, depth } = entry;
    count += 1;
    if (count > maxNodes) return { path, message: `節點超過 ${maxNodes} 個` };
    if (depth > maxDepth) return { path, message: `巢狀超過 ${maxDepth} 層` };

    const rule = CONTENT_RULES[node.type];
    if (!rule || (depth > 0 && node.type === 'doc')) {
      return { path: [...path, 'type'], message: `不支援的節點 ${node.type}` };
    }
    const issue = nodeIssue(node, path);
    if (issue) return issue;

    const children = node.content ?? [];
    if (rule.nonEmpty && children.length === 0) {
      return { path: [...path, 'content'], message: `${node.type} 至少要有一個子節點` };
    }
    if (rule.firstParagraph && children[0]?.type !== 'paragraph') {
      return { path: [...path, 'content', 0], message: `${node.type} 的第一個子節點必須是段落` };
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (!child) continue;
      const childPath = [...path, 'content', index];
      if (!rule.allowed.has(child.type)) {
        return { path: childPath, message: `${node.type} 裡不能放 ${child.type}` };
      }
      if (rule.noMarks && child.marks?.length) {
        return { path: [...childPath, 'marks'], message: `${node.type} 裡的文字不能有標記` };
      }
      stack.push({ node: child, path: childPath, depth: depth + 1 });
    }
  }
  return undefined;
}

/** 單一節點自己的欄位：文字、標記、屬性。 */
function nodeIssue(node: RichTextNode, path: Array<string | number>): RichTextIssue | undefined {
  if (node.type === 'text') {
    if (!node.text) return { path: [...path, 'text'], message: '文字節點不能是空字串' };
  } else if (node.text !== undefined) {
    return { path: [...path, 'text'], message: '只有文字節點可以有 text' };
  }
  if (node.marks && node.type !== 'text') {
    return { path: [...path, 'marks'], message: '只有文字節點可以有標記' };
  }
  const seen = new Set<string>();
  for (const [index, mark] of (node.marks ?? []).entries()) {
    const markPath = [...path, 'marks', index];
    if (!MARK_TYPES.has(mark.type)) return { path: markPath, message: `不支援的標記 ${mark.type}` };
    if (seen.has(mark.type)) return { path: markPath, message: `重複的標記 ${mark.type}` };
    seen.add(mark.type);
    if (mark.type === 'link' && !isSafeLinkHref(mark.attrs?.href)) {
      return {
        path: [...markPath, 'attrs', 'href'],
        message: '連結只接受 http、https、mailto 與站內路徑',
      };
    }
  }
  if (node.type === 'heading' && !HEADING_LEVELS.has(node.attrs?.level)) {
    return { path: [...path, 'attrs', 'level'], message: '標題層級只能是 2 或 3' };
  }
  if (node.type === 'orderedList' && node.attrs?.start !== undefined) {
    const start = node.attrs.start;
    if (typeof start !== 'number' || !Number.isInteger(start) || start < 0) {
      return { path: [...path, 'attrs', 'start'], message: '編號清單的起始值必須是非負整數' };
    }
  }
  return undefined;
}

/**
 * 文件合乎內容規則（`findRichTextIssue` 沒有問題）：前端送出前以與後端相同的規則檢查，
 * 通過後型別縮小成 `ValidRichTextDocument`，不必轉型就能放進 API 的請求。
 */
export function isValidRichTextDocument(
  document: RichTextDocument,
  limits?: RichTextLimits,
): document is ValidRichTextDocument {
  return findRichTextIssue(document, limits) === undefined;
}
