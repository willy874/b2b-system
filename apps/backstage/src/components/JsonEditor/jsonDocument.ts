import { ensureSyntaxTree, foldEffect, syntaxTree } from '@codemirror/language';
import type { EditorState, StateEffect } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';

import type { JsonContainerKind, JsonPath } from '../JsonViewer/jsonLines';

/** `@lezer/json` 裡代表一個 JSON 值的節點。 */
const VALUE_NODES = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null']);
const CONTAINER_NODES = new Set(['Object', 'Array']);

/** 找路徑、摺疊前要解析完整份文件；超過這個時間（ms）就用目前解析到的部分。 */
const PARSE_TIMEOUT = 200;

function fullTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT) ?? syntaxTree(state);
}

function valueChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (VALUE_NODES.has(child.name)) children.push(child);
  }
  return children;
}

function propertyKey(state: EditorState, property: SyntaxNode): string | undefined {
  const name = property.getChild('PropertyName');
  if (!name) return undefined;
  try {
    return JSON.parse(state.doc.sliceString(name.from, name.to)) as string;
  } catch {
    // 打到一半的鍵名（例如少了結尾引號）：這個屬性對不到任何路徑
    return undefined;
  }
}

function rootValue(tree: Tree): SyntaxNode | undefined {
  return valueChildren(tree.topNode)[0];
}

interface PathTarget {
  value: SyntaxNode;
  /** 物件成員時是整個 `Property`（含鍵名）。 */
  property: SyntaxNode | undefined;
}

function childTarget(
  state: EditorState,
  node: SyntaxNode,
  segment: string | number,
): PathTarget | undefined {
  if (node.name === 'Object' && typeof segment === 'string') {
    let found: PathTarget | undefined;
    // 重複的鍵以最後一個為準，與 JSON.parse 相同
    for (const property of node.getChildren('Property')) {
      if (propertyKey(state, property) !== segment) continue;
      const value = valueChildren(property)[0];
      if (value) found = { value, property };
    }
    return found;
  }
  if (node.name === 'Array' && typeof segment === 'number') {
    const value = valueChildren(node)[segment];
    return value ? { value, property: undefined } : undefined;
  }
  return undefined;
}

/**
 * 路徑在文件裡要標示的範圍（驗證錯誤的底線、跳到錯誤的位置）：
 * 物件成員標鍵名（值是基本型別時連值一起），陣列元素與根節點標值；值是物件／陣列時只標開頭的括號，
 * 不會整塊都畫上底線。找不到（文件與值不同步、打到一半）時回傳 `undefined`。
 */
export function findPathRange(
  state: EditorState,
  path: JsonPath,
): { from: number; to: number } | undefined {
  const root = rootValue(fullTree(state));
  if (!root) return undefined;
  let target: PathTarget = { value: root, property: undefined };
  for (const segment of path) {
    const next = childTarget(state, target.value, segment);
    if (!next) return undefined;
    target = next;
  }
  const { value, property } = target;
  const isContainer = CONTAINER_NODES.has(value.name);
  const name = property?.getChild('PropertyName');
  if (name) return { from: name.from, to: isContainer ? name.to : value.to };
  return { from: value.from, to: isContainer ? value.from + 1 : value.to };
}

/** 與 `@codemirror/lang-json` 的 `foldInside` 相同的範圍：括號之間；只佔一行的容器不能摺疊。 */
function foldRange(state: EditorState, node: SyntaxNode): { from: number; to: number } | undefined {
  const from = node.from + 1;
  const to = node.to - 1;
  if (to <= from || state.doc.lineAt(from).number === state.doc.lineAt(to).number) return undefined;
  return { from, to };
}

/**
 * 摺疊深度剛好是 `depth` 的物件／陣列（根節點深度為 0），更深的跟著藏在裡面。
 * `JsonViewer` 的 `defaultExpandDepth` 與「全部收合」（`depth` = 1）都用它。
 */
export function foldAtDepth(state: EditorState, depth: number): StateEffect<unknown>[] {
  const root = rootValue(fullTree(state));
  if (!root || !Number.isFinite(depth)) return [];
  const ranges: Array<{ from: number; to: number }> = [];
  const stack: Array<{ node: SyntaxNode; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth: current } = stack.pop() as { node: SyntaxNode; depth: number };
    if (!CONTAINER_NODES.has(node.name)) continue;
    if (current >= depth) {
      const range = foldRange(state, node);
      if (range) ranges.push(range);
      continue;
    }
    const children =
      node.name === 'Object'
        ? node.getChildren('Property').flatMap((property) => valueChildren(property))
        : valueChildren(node);
    for (const child of children) stack.push({ node: child, depth: current + 1 });
  }
  // CodeMirror 要求同一次加入的摺疊依位置排序；堆疊走訪的順序是反的
  return ranges.toSorted((a, b) => a.from - b.from).map((range) => foldEffect.of(range));
}

/** 摺疊範圍所屬的容器與成員數（摺疊的 `…` 顯示摘要用）。 */
export function describeFold(
  state: EditorState,
  range: { from: number; to: number },
): { size: number; container: JsonContainerKind } | undefined {
  const container = syntaxTree(state).resolveInner(range.from, -1).parent;
  if (!container || !CONTAINER_NODES.has(container.name)) return undefined;
  return container.name === 'Object'
    ? { size: container.getChildren('Property').length, container: 'object' }
    : { size: valueChildren(container).length, container: 'array' };
}
