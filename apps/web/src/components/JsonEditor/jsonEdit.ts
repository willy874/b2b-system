import type { JsonPath } from '../JsonViewer/jsonLines';

/**
 * JsonEditor 的資料操作：全部不可變（回傳新的根，只複製路徑上的容器），
 * 撤銷／重做只要保存每一步的根即可，未改到的子樹與前一版共用參考。
 */

type Container = Record<string, unknown> | unknown[];

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null;
}

export function getIn(root: unknown, path: JsonPath): unknown {
  let node = root;
  for (const segment of path) {
    if (!isContainer(node)) return undefined;
    node = (node as Record<string | number, unknown>)[segment];
  }
  return node;
}

/** 以 `update` 取代 `path` 所在容器（`path` 為空時取代根）。 */
function updateIn(root: unknown, path: JsonPath, update: (node: unknown) => unknown): unknown {
  if (path.length === 0) return update(root);
  const [head, ...tail] = path as [string | number, ...Array<string | number>];
  if (!isContainer(root)) throw new Error(`路徑不存在：${String(head)}`);
  const child = updateIn((root as Record<string | number, unknown>)[head], tail, update);
  if (Array.isArray(root)) {
    const next = [...root];
    next[head as number] = child;
    return next;
  }
  return { ...root, [head]: child };
}

export function setIn(root: unknown, path: JsonPath, value: unknown): unknown {
  return updateIn(root, path, () => value);
}

function splitPath(path: JsonPath): [JsonPath, string | number] {
  if (path.length === 0) throw new Error('根節點沒有上層容器');
  return [path.slice(0, -1), path.at(-1) as string | number];
}

export function removeIn(root: unknown, path: JsonPath): unknown {
  const [parentPath, key] = splitPath(path);
  return updateIn(root, parentPath, (parent) => {
    if (Array.isArray(parent)) return parent.filter((_, index) => index !== key);
    const { [key]: _removed, ...rest } = parent as Record<string, unknown>;
    return rest;
  });
}

/** 改鍵名並保留原本的順序；新名稱已存在時丟錯（呼叫端先用 `hasKey` 檢查）。 */
export function renameKey(root: unknown, path: JsonPath, nextKey: string): unknown {
  const [parentPath, key] = splitPath(path);
  if (key === nextKey) return root;
  return updateIn(root, parentPath, (parent) => {
    if (hasKey(parent, nextKey)) throw new Error(`鍵名重複：${nextKey}`);
    return Object.fromEntries(
      Object.entries(parent as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey === key ? nextKey : entryKey,
        entryValue,
      ]),
    );
  });
}

export function hasKey(node: unknown, key: string): boolean {
  return isContainer(node) && !Array.isArray(node) && Object.hasOwn(node, key);
}

/** `base`、`base1`、`base2`… 中第一個不在物件裡的鍵名。 */
export function uniqueKey(node: unknown, base: string): string {
  if (!hasKey(node, base)) return base;
  for (let index = 1; ; index += 1) {
    const candidate = `${base}${index}`;
    if (!hasKey(node, candidate)) return candidate;
  }
}

export interface InsertResult {
  root: unknown;
  /** 新節點的路徑，讓編輯器接著進入編輯。 */
  path: JsonPath;
}

/** 在 `path` 這個節點後面插入同層的新節點（物件時鍵名由 `keyBase` 產生、不重複）。 */
export function insertAfter(
  root: unknown,
  path: JsonPath,
  value: unknown,
  keyBase: string,
): InsertResult {
  const [parentPath, key] = splitPath(path);
  const parent = getIn(root, parentPath);
  if (Array.isArray(parent)) {
    const index = (key as number) + 1;
    return {
      root: setIn(root, parentPath, [...parent.slice(0, index), value, ...parent.slice(index)]),
      path: [...parentPath, index],
    };
  }
  const newKey = uniqueKey(parent, keyBase);
  const entries = Object.entries(parent as Record<string, unknown>);
  const at = entries.findIndex(([entryKey]) => entryKey === key) + 1;
  entries.splice(at, 0, [newKey, value]);
  return {
    root: setIn(root, parentPath, Object.fromEntries(entries)),
    path: [...parentPath, newKey],
  };
}

/** 在容器 `path` 的最後加一個子節點。 */
export function appendChild(
  root: unknown,
  path: JsonPath,
  value: unknown,
  keyBase: string,
): InsertResult {
  const node = getIn(root, path);
  if (Array.isArray(node)) {
    return { root: setIn(root, path, [...node, value]), path: [...path, node.length] };
  }
  if (!isContainer(node)) throw new Error('只有物件或陣列可以新增子項');
  const newKey = uniqueKey(node, keyBase);
  return { root: setIn(root, path, { ...node, [newKey]: value }), path: [...path, newKey] };
}

/** 複製一份放在原節點後面。 */
export function duplicate(root: unknown, path: JsonPath): InsertResult {
  const [, key] = splitPath(path);
  return insertAfter(root, path, structuredClone(getIn(root, path)), String(key));
}

export type JsonConvertTarget = 'object' | 'array' | 'value';

/**
 * 轉換節點型別（對應 svelte-jsoneditor 的 Convert）：
 * 物件 ↔ 陣列保留值（陣列轉物件以索引為鍵）；轉成值時輸出 JSON 字串；值轉成容器時包成單一元素。
 */
export function convert(node: unknown, target: JsonConvertTarget): unknown {
  if (target === 'value') return isContainer(node) ? JSON.stringify(node) : node;
  if (target === 'array') {
    if (Array.isArray(node)) return node;
    return isContainer(node) ? Object.values(node) : [node];
  }
  if (Array.isArray(node))
    return Object.fromEntries(node.map((item, index) => [String(index), item]));
  return isContainer(node) ? node : { value: node };
}

/**
 * 編輯框裡的文字；字串不帶引號，其他型別是 JSON 字面。
 * 字串內容本身會被 `fromEditText` 讀成別的型別時（`"123"`、`"true"`）才加引號，原樣送出不會改變型別。
 */
export function toEditText(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value);
  return fromEditText(value) === value ? value : JSON.stringify(value);
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * 把編輯框的文字轉回值（與 svelte-jsoneditor 相同，自動判斷型別）：
 * `true` / `false` / `null` 與合法的 JSON 數字轉成對應型別，其餘都是字串。
 * 想要字串的 `"123"` 時，輸入時加上引號：`"123"`。
 */
export function fromEditText(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (NUMBER.test(text)) return Number(text);
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text) as string;
    } catch {
      // 不是合法的 JSON 字串字面（例如內含未跳脫的引號）：原樣當作字串
    }
  }
  return text;
}
