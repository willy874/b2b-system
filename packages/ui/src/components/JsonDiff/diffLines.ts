/** 一行在差異裡的角色：兩邊都有、只在新版、只在舊版。 */
export type JsonDiffKind = 'equal' | 'added' | 'removed';

export interface JsonDiffLine {
  kind: JsonDiffKind;
  /** 顯示的文字（兩邊都有的行取新版，逗號以新版為準）。 */
  text: string;
  /** 在舊版的行號（1 起算）；新增的行為 `undefined`。 */
  oldLineNumber: number | undefined;
  /** 在新版的行號（1 起算）；刪除的行為 `undefined`。 */
  newLineNumber: number | undefined;
}

/** 連續幾行沒有變更、被收起來的區段。 */
export interface JsonDiffFold {
  kind: 'fold';
  /** 區段第一行在 `JsonDiffLine[]` 的位置；也是展開時的識別。 */
  start: number;
  count: number;
}

export type JsonDiffRow = JsonDiffLine | JsonDiffFold;

/** `undefined`（這一邊不存在，例如建立前、刪除後）是零行，而不是一行 `undefined`。 */
export function toJsonText(value: unknown): string[] {
  if (value === undefined) return [];
  const text = JSON.stringify(value, null, 2) as string | undefined;
  return text === undefined ? [] : text.split('\n');
}

/**
 * 比對用的鍵：去掉行尾逗號。陣列尾端新增一項時，原本的最後一行多了逗號，
 * 若照字面比對會變成「刪一行、加一行」，這裡把它視為沒變。
 */
const compareKey = (line: string) => (line.endsWith(',') ? line.slice(0, -1) : line);

/**
 * 逐行比對兩份 JSON（Myers 差異演算法，O((N + M)·D)，D 是變更的行數）：
 * 稽核的前後通常只差幾行，就算整份資料很長也很快。
 * 同一段變更先列刪除、再列新增，與 `git diff` 相同。
 */
export function diffJsonLines(before: unknown, after: unknown): JsonDiffLine[] {
  const a = toJsonText(before);
  const b = toJsonText(after);
  const keyA = a.map(compareKey);
  const keyB = b.map(compareKey);
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  // v[k + offset]：對角線 k 上走得最遠的 x；trace[d] 是第 d 步開始前的 v
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  const pickDown = (vector: Int32Array, d: number, k: number) =>
    k === -d || (k !== d && (vector[k - 1 + offset] ?? 0) < (vector[k + 1 + offset] ?? 0));

  search: for (let d = 0; d <= max; d++) {
    trace.push(v);
    v = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = pickDown(v, d, k) ? (v[k + 1 + offset] ?? 0) : (v[k - 1 + offset] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && keyA[x] === keyB[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) break search;
    }
  }

  // 從終點沿 trace 走回起點，得到反向的操作序列
  const reversed: JsonDiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vector = trace[d] as Int32Array;
    const k = x - y;
    const prevK = pickDown(vector, d, k) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : (vector[prevK + offset] ?? 0);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      reversed.push({
        kind: 'equal',
        text: b[y - 1] as string,
        oldLineNumber: x,
        newLineNumber: y,
      });
      x--;
      y--;
    }
    if (d === 0) break;
    if (x === prevX) {
      reversed.push({
        kind: 'added',
        text: b[y - 1] as string,
        oldLineNumber: undefined,
        newLineNumber: y,
      });
      y--;
    } else {
      reversed.push({
        kind: 'removed',
        text: a[x - 1] as string,
        oldLineNumber: x,
        newLineNumber: undefined,
      });
      x--;
    }
  }
  return reversed.toReversed();
}

/**
 * 只留下變更附近 `context` 行，其餘連續未變更的行收成一個摺疊列。
 * 只有一行的區段不收（摺疊列本身就佔一行）。`expanded` 是已展開的摺疊區段（`JsonDiffFold.start`）。
 */
export function toJsonDiffRows(
  lines: readonly JsonDiffLine[],
  context: number,
  expanded: ReadonlySet<number>,
): JsonDiffRow[] {
  const isVisible = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === 'equal') return;
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length - 1, index + context);
    for (let i = from; i <= to; i++) isVisible[i] = true;
  });

  const rows: JsonDiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    if (isVisible[index]) {
      rows.push(lines[index] as JsonDiffLine);
      index++;
      continue;
    }
    const start = index;
    while (index < lines.length && !isVisible[index]) index++;
    const count = index - start;
    if (count > 1 && !expanded.has(start)) {
      rows.push({ kind: 'fold', start, count });
    } else {
      rows.push(...lines.slice(start, index));
    }
  }
  return rows;
}

export type JsonTokenKind =
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'punctuation'
  | 'space';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const TOKEN_PATTERN =
  /("(?:[^"\\]|\\.)*")(?=\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false)|(null)|([{}[\]:,])|(\s+)/y;

const GROUP_KIND = [
  'key',
  'string',
  'number',
  'boolean',
  'null',
  'punctuation',
  'space',
] as const satisfies readonly JsonTokenKind[];

/**
 * 把 `JSON.stringify(value, null, 2)` 的一行切成語法上色用的片段。
 * 只處理格式化過的 JSON 會出現的東西；認不得的字元當成標點原樣保留，不會吃掉文字。
 */
export function tokenizeJsonLine(line: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  while (TOKEN_PATTERN.lastIndex < line.length) {
    const position = TOKEN_PATTERN.lastIndex;
    const match = TOKEN_PATTERN.exec(line);
    if (!match) {
      tokens.push({ kind: 'punctuation', text: line.charAt(position) });
      TOKEN_PATTERN.lastIndex = position + 1;
      continue;
    }
    const group = match.findIndex((text, index) => index > 0 && text !== undefined);
    tokens.push({ kind: GROUP_KIND[group - 1] ?? 'punctuation', text: match[0] });
  }
  return tokens;
}
