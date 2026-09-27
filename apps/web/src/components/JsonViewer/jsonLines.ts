export type JsonContainerKind = 'object' | 'array';
export type JsonPrimitiveKind = 'string' | 'number' | 'boolean' | 'null' | 'other';

interface JsonLineBase {
  /** 節點路徑（`$`、`$["a"][0]`）；同一份資料裡唯一，收合狀態以它為鍵。 */
  path: string;
  /**
   * 在完整展開、縮排 2 格的 JSON 文字（`JSON.stringify(value, null, 2)`）裡是第幾行（1 起算）。
   * 收合的容器之後會跳號，與 CodeMirror 摺疊後的行號一致。
   */
  lineNumber: number;
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

/** 收合的物件／陣列（或空容器）只佔一行：`"key": {…}` */
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

function entriesOf(node: object): Array<[string | number, unknown]> {
  return Array.isArray(node) ? node.map((item, index) => [index, item]) : Object.entries(node);
}

/**
 * 這個值完整展開時佔幾行：基本型別與空容器 1 行，非空容器是開頭、結尾加上每個成員。
 * 以後序迴圈（不遞迴）計算並快取在 `cache`；循環參照與 `toJsonLines` 一樣算成 1 行。
 */
function countLines(value: unknown, cache: WeakMap<object, number>): number {
  if (typeof value !== 'object' || value === null) return 1;
  const cached = cache.get(value);
  if (cached !== undefined) return cached;

  const inProgress = new Set<object>();
  const stack: Array<{ node: object; isExpanded: boolean }> = [{ node: value, isExpanded: false }];
  while (stack.length > 0) {
    const frame = stack.pop() as { node: object; isExpanded: boolean };
    const children = entriesOf(frame.node).map(([, child]) => child);
    if (!frame.isExpanded) {
      if (cache.has(frame.node)) continue;
      inProgress.add(frame.node);
      stack.push({ node: frame.node, isExpanded: true });
      for (const child of children) {
        if (typeof child === 'object' && child !== null && !cache.has(child)) {
          if (!inProgress.has(child)) stack.push({ node: child, isExpanded: false });
        }
      }
      continue;
    }
    inProgress.delete(frame.node);
    const inner = children.reduce<number>(
      (sum, child) =>
        sum + (typeof child === 'object' && child !== null ? (cache.get(child) ?? 1) : 1),
      0,
    );
    cache.set(frame.node, children.length === 0 ? 1 : inner + 2);
  }
  return cache.get(value) ?? 1;
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
  const lineCounts = new WeakMap<object, number>();
  let lineNumber = 1;

  type Frame =
    | { kind: 'node'; value: unknown; path: string; depth: number; key?: string; comma: boolean }
    | { kind: 'close'; line: Omit<JsonCloseLine, 'lineNumber'>; source: object };
  const stack: Frame[] = [{ kind: 'node', value, path: ROOT_PATH, depth: 0, comma: false }];

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    if (frame.kind === 'close') {
      ancestors.delete(frame.source);
      lines.push({ ...frame.line, lineNumber });
      lineNumber += 1;
      continue;
    }

    const { value: node, path, depth, key, comma } = frame;
    const base = { path, lineNumber, depth, key, comma };

    if (typeof node !== 'object' || node === null) {
      lines.push({ ...base, type: 'value', ...formatPrimitive(node) });
      lineNumber += 1;
      continue;
    }
    if (ancestors.has(node)) {
      lines.push({ ...base, type: 'value', kind: 'other', text: '[Circular]' });
      lineNumber += 1;
      continue;
    }

    const container: JsonContainerKind = Array.isArray(node) ? 'array' : 'object';
    const entries = entriesOf(node);

    if (entries.length === 0 || isCollapsed(path, depth)) {
      lines.push({ ...base, type: 'collapsed', container, size: entries.length });
      // 收合的內容仍佔行號（CodeMirror 摺疊後也是跳號）
      lineNumber += countLines(node, lineCounts);
      continue;
    }

    // 逗號接在結尾那一行（`},`），開頭那一行不接
    lines.push({ ...base, comma: false, type: 'open', container, size: entries.length });
    lineNumber += 1;
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

export type JsonPath = ReadonlyArray<string | number>;

/** 路徑陣列（`['a', 0]`）轉成 `toJsonLines` 使用的路徑字串（`$["a"][0]`）。 */
export function formatPath(segments: JsonPath): string {
  return segments.reduce<string>(childPath, ROOT_PATH);
}
