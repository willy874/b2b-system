export type JsonContainerKind = 'object' | 'array';
export type JsonPrimitiveKind = 'string' | 'number' | 'boolean' | 'null' | 'other';

interface JsonLineBase {
  /** 節點路徑（`$`、`$["a"][0]`）；同一份資料裡唯一，收合狀態以它為鍵。 */
  path: string;
  depth: number;
  /** 物件屬性名稱；陣列元素與根節點沒有。 */
  key: string | undefined;
  /** 後面接逗號（不是所屬容器的最後一個元素）。 */
  comma: boolean;
}

/** 展開中的物件／陣列的開頭一行：`"key": {` */
export interface JsonOpenLine extends JsonLineBase {
  type: 'open';
  container: JsonContainerKind;
  size: number;
}

/** 展開中的物件／陣列的結尾一行：`},` */
export interface JsonCloseLine extends JsonLineBase {
  type: 'close';
  container: JsonContainerKind;
}

/** 收合的物件／陣列（或空容器）只佔一行：`"key": { … }` */
export interface JsonCollapsedLine extends JsonLineBase {
  type: 'collapsed';
  container: JsonContainerKind;
  size: number;
}

export interface JsonValueLine extends JsonLineBase {
  type: 'value';
  kind: JsonPrimitiveKind;
  /** 已格式化的文字（字串含引號與跳脫）。 */
  text: string;
}

export type JsonLine = JsonOpenLine | JsonCloseLine | JsonCollapsedLine | JsonValueLine;

export const ROOT_PATH = '$';

function childPath(parent: string, key: string | number): string {
  return typeof key === 'number' ? `${parent}[${key}]` : `${parent}[${JSON.stringify(key)}]`;
}

function formatPrimitive(value: unknown): { kind: JsonPrimitiveKind; text: string } {
  if (value === null) return { kind: 'null', text: 'null' };
  switch (typeof value) {
    case 'string':
      return { kind: 'string', text: JSON.stringify(value) };
    case 'number':
      return { kind: 'number', text: Number.isFinite(value) ? String(value) : 'null' };
    case 'boolean':
      return { kind: 'boolean', text: String(value) };
    case 'bigint':
      return { kind: 'number', text: String(value) };
    default:
      // undefined、函式、symbol：JSON 沒有對應的值，照 JS 的字面顯示
      return { kind: 'other', text: String(value) };
  }
}

/**
 * 把任意值攤平成「一行一個元素」的清單，供虛擬捲動逐行渲染。
 * `isCollapsed(path, depth)` 決定每個非空容器要展開成多行，或收成一行。
 * 以迴圈（不遞迴）走訪，資料很深也不會爆堆疊；循環參照顯示成 `[Circular]`。
 */
export function toJsonLines(
  value: unknown,
  isCollapsed: (path: string, depth: number) => boolean,
): JsonLine[] {
  const lines: JsonLine[] = [];
  const ancestors = new Set<object>();

  type Frame =
    | { kind: 'node'; value: unknown; path: string; depth: number; key?: string; comma: boolean }
    | { kind: 'close'; line: JsonCloseLine; source: object };
  const stack: Frame[] = [{ kind: 'node', value, path: ROOT_PATH, depth: 0, comma: false }];

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    if (frame.kind === 'close') {
      ancestors.delete(frame.source);
      lines.push(frame.line);
      continue;
    }

    const { value: node, path, depth, key, comma } = frame;
    const base = { path, depth, key, comma };

    if (typeof node !== 'object' || node === null) {
      lines.push({ ...base, type: 'value', ...formatPrimitive(node) });
      continue;
    }
    if (ancestors.has(node)) {
      lines.push({ ...base, type: 'value', kind: 'other', text: '[Circular]' });
      continue;
    }

    const container: JsonContainerKind = Array.isArray(node) ? 'array' : 'object';
    const entries: Array<[string | number, unknown]> = Array.isArray(node)
      ? node.map((item, index) => [index, item])
      : Object.entries(node);

    if (entries.length === 0 || isCollapsed(path, depth)) {
      lines.push({ ...base, type: 'collapsed', container, size: entries.length });
      continue;
    }

    lines.push({ ...base, type: 'open', container, size: entries.length });
    ancestors.add(node);
    stack.push({
      kind: 'close',
      source: node,
      line: { path, depth, key: undefined, comma, type: 'close', container },
    });
    // 反向推入，出堆疊時才會是原本的順序
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [entryKey, entryValue] = entries[index] as [string | number, unknown];
      stack.push({
        kind: 'node',
        value: entryValue,
        path: childPath(path, entryKey),
        depth: depth + 1,
        key: typeof entryKey === 'string' ? entryKey : undefined,
        comma: index < entries.length - 1,
      });
    }
  }
  return lines;
}
