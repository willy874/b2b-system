import { parseSubjectSpec } from './authz.model';
import type { AuthzModel, Rewrite } from './authz.model';

/** 物件：`型別:id`。 */
export interface ObjectRef {
  readonly type: string;
  readonly id: string;
}

/**
 * 主體鍵的字串形式：`user:<id>`、`user:*`、`role:<id>#holder`。
 * 快照與主體閉包都用這個形式比對，省去逐欄比較。
 */
export type SubjectKey = string;

export function objectKey(object: ObjectRef): string {
  return `${object.type}:${object.id}`;
}

export function subjectKey(type: string, id: string, relation = ''): SubjectKey {
  return relation ? `${type}:${id}#${relation}` : `${type}:${id}`;
}

/** `SubjectKey` → 物件與關係（`user:*` 的 id 是 `*`）。 */
export function parseSubjectKey(key: SubjectKey): { object: ObjectRef; relation: string } {
  const hash = key.indexOf('#');
  const node = hash < 0 ? key : key.slice(0, hash);
  const colon = node.indexOf(':');
  return {
    object: { type: node.slice(0, colon), id: node.slice(colon + 1) },
    relation: hash < 0 ? '' : key.slice(hash + 1),
  };
}

/**
 * 一次判斷所需的資料。由呼叫端準備（通常是一次請求、一位操作者）：
 * - `subjects`：操作者的主體閉包——本人、`user:*`、他屬於的使用者集合（`role:<id>#holder`…）。
 * - `subjectsOf`：物件上某個關係的直接 tuple 的主體（已濾掉過期的）。結構邊（上層、建立者）也從這裡供應。
 */
export interface AuthzSnapshot {
  readonly subjects: ReadonlySet<SubjectKey>;
  subjectsOf(object: ObjectRef, relation: string): readonly SubjectKey[];
}

/** 成立時走過的路徑（由操作者往目標），`explain` 用。 */
export type AuthzPath = readonly string[];

export interface AuthzChecker {
  check(object: ObjectRef, relation: string): boolean;
  /** 成立的一條路徑；不成立是 null。 */
  explain(object: ObjectRef, relation: string): AuthzPath | null;
  /**
   * 替某個物件補上臨時的邊（例：列表裡的每個檔案的 `parent`、`owner`，不必事先載入快照）。
   * 其他物件的結果沿用同一份記憶。
   */
  withEdges(
    object: ObjectRef,
    edges: Readonly<Record<string, readonly SubjectKey[]>>,
  ): AuthzChecker;
}

/** 遞迴深度上限：模型與資料都不該這麼深，超過視為不成立（防止資料異常時爆堆疊）。 */
const MAX_DEPTH = 64;

/**
 * 以快照建立判斷器：同一個判斷器內對同一個 `物件#關係` 只算一次。
 * 未知的型別或關係（例：目錄刪掉、tuple 還留著的權限鍵）視為不成立，不丟錯。
 */
export function createChecker(
  model: AuthzModel,
  snapshot: AuthzSnapshot,
  parentMemo?: { memo: Map<string, AuthzPath | null>; except: string },
): AuthzChecker {
  const memo = new Map<string, AuthzPath | null>();
  const inProgress = new Set<string>();

  const lookup = (key: string): AuthzPath | null | undefined => {
    const own = memo.get(key);
    if (own !== undefined || memo.has(key)) return own;
    if (parentMemo && !key.startsWith(`${parentMemo.except}#`)) {
      if (parentMemo.memo.has(key)) return parentMemo.memo.get(key) ?? null;
    }
    return undefined;
  };

  const evaluate = (object: ObjectRef, relation: string, depth: number): AuthzPath | null => {
    const key = `${objectKey(object)}#${relation}`;
    const cached = lookup(key);
    if (cached !== undefined) return cached;
    // 循環（例：資料異常的上層鏈）視為不成立
    if (inProgress.has(key) || depth > MAX_DEPTH) return null;
    const rewrite = model.types.get(object.type)?.relations[relation];
    if (!rewrite) {
      memo.set(key, null);
      return null;
    }
    inProgress.add(key);
    const path = evaluateRewrite(object, relation, rewrite, depth);
    inProgress.delete(key);
    memo.set(key, path);
    return path;
  };

  const evaluateRewrite = (
    object: ObjectRef,
    relation: string,
    rewrite: Rewrite,
    depth: number,
  ): AuthzPath | null => {
    const here = `${objectKey(object)}#${relation}`;
    switch (rewrite.kind) {
      case 'direct': {
        for (const subject of snapshot.subjectsOf(object, relation)) {
          if (!isAllowedSubject(rewrite.subjects, subject)) continue;
          if (snapshot.subjects.has(subject)) return [subject, here];
          // 使用者集合不在閉包裡時再往下展開（閉包沒有涵蓋的關係，例如計算出來的集合）
          const parsed = parseSubjectKey(subject);
          if (parsed.relation && parsed.object.id !== '*') {
            const nested = evaluate(parsed.object, parsed.relation, depth + 1);
            if (nested) return [...nested, here];
          }
        }
        return null;
      }
      case 'computed': {
        const inner = evaluate(object, rewrite.relation, depth + 1);
        return inner ? [...inner, here] : null;
      }
      case 'from': {
        for (const target of snapshot.subjectsOf(object, rewrite.tupleset)) {
          const parsed = parseSubjectKey(target);
          const inner = evaluate(parsed.object, rewrite.relation, depth + 1);
          if (inner) return [...inner, here];
        }
        return null;
      }
      case 'union': {
        for (const child of rewrite.children) {
          const inner = evaluateRewrite(object, relation, child, depth);
          if (inner) return inner;
        }
        return null;
      }
      case 'intersection': {
        let first: AuthzPath | null = null;
        for (const child of rewrite.children) {
          const inner = evaluateRewrite(object, relation, child, depth);
          if (!inner) return null;
          first ??= inner;
        }
        return first;
      }
    }
  };

  return {
    check: (object, relation) => evaluate(object, relation, 0) !== null,
    explain: (object, relation) => evaluate(object, relation, 0),
    withEdges(object, edges) {
      const target = objectKey(object);
      const overlay: AuthzSnapshot = {
        subjects: snapshot.subjects,
        subjectsOf: (candidate, relation) =>
          objectKey(candidate) === target && relation in edges
            ? (edges[relation] ?? [])
            : snapshot.subjectsOf(candidate, relation),
      };
      return createChecker(model, overlay, { memo, except: target });
    },
  };
}

/** tuple 的主體是否符合關係定義允許的主體種類（`user`、`user:*`、`role#holder`）。 */
function isAllowedSubject(specs: readonly string[], subject: SubjectKey): boolean {
  const { object, relation } = parseSubjectKey(subject);
  return specs.some((spec) => {
    const allowed = parseSubjectSpec(spec);
    if (allowed.type !== object.type) return false;
    if (allowed.wildcard) return object.id === '*' && !relation;
    if (object.id === '*') return false;
    return (allowed.relation ?? '') === relation;
  });
}

/**
 * `explain()` 的路徑從主體閉包裡的主體開始（例：`role:r#holder`）；接上那個主體是怎麼來的
 * （`AuthzRepository.closurePaths`：`user:u → group:g#member → role:r#holder`），才是從使用者本人出發的完整路徑。
 */
export function withClosurePath(
  path: AuthzPath,
  closure: ReadonlyMap<SubjectKey, readonly SubjectKey[]>,
): AuthzPath {
  const [first, ...rest] = path;
  if (first === undefined) return path;
  return [...(closure.get(first) ?? [first]), ...rest];
}
