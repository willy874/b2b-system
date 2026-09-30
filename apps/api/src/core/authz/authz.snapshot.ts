import { objectKey } from './authz.checker';
import type { AuthzSnapshot, ObjectRef, SubjectKey } from './authz.checker';

/** 一條 tuple 的最小形式：`物件#關係@主體`。 */
export interface TupleEntry {
  object: ObjectRef;
  relation: string;
  subject: SubjectKey;
}

/**
 * 邊的供應者：tuple 表以外的來源（資料夾的上層、建立者，D3）或每個物件都有的隱含邊（`tenant`）。
 * 回傳 undefined 表示這個供應者不處理，交給 tuple。
 */
export type EdgeProvider = (
  object: ObjectRef,
  relation: string,
) => readonly SubjectKey[] | undefined;

/** 由記憶體中的 tuple 與供應者組出快照；tuple 依 `物件#關係` 建索引。 */
export function createSnapshot(
  subjects: Iterable<SubjectKey>,
  tuples: Iterable<TupleEntry>,
  providers: readonly EdgeProvider[] = [],
): AuthzSnapshot {
  const index = new Map<string, SubjectKey[]>();
  for (const tuple of tuples) {
    const key = `${objectKey(tuple.object)}#${tuple.relation}`;
    const list = index.get(key);
    if (list) list.push(tuple.subject);
    else index.set(key, [tuple.subject]);
  }
  return {
    subjects: new Set(subjects),
    subjectsOf(object, relation) {
      for (const provider of providers) {
        const provided = provider(object, relation);
        if (provided) return provided;
      }
      return index.get(`${objectKey(object)}#${relation}`) ?? [];
    },
  };
}
