/**
 * 資源依賴圖：把「後端改了什麼」換算成「前端哪些 query 要失效」。
 *
 * 兩個角色、一條邏輯線：
 * - mutation 只宣告 **來源變更**（`ResourceChange`）：改了哪個資源、哪一筆、連帶哪些 id。
 * - 每個資源宣告 **自己的資料由哪些來源組成**（`derivesFrom`）。
 *
 * 換算只走一層（來源 → 衍生），不做遞移：衍生資料（例如角色的 userCount）變了，
 * 不代表嵌入角色摘要的使用者也變了。需要的依賴一律直接宣告到來源上，
 * 所以不會有循環、也不會因為一筆寫入沿著圖擴散到整個快取。
 * 查找用建圖時產生的反向索引（來源 → 衍生規則），成本只跟該來源的邊數有關。
 */

export type ChangeKind = 'create' | 'update' | 'delete';

/** 無法得知受影響的是哪幾筆時使用：退回以 key 前綴失效該資源的所有實體。 */
export const ANY_ID = '*';

export interface ResourceChange<R extends string = string> {
  resource: R;
  kind: ChangeKind;
  /** 被改的那一筆；`create` 通常沒有。 */
  id?: string;
  /** 同一次寫入連帶影響的其他資源 id（例：指派角色時新舊角色的 id）。 */
  refs?: Partial<Record<R, readonly string[]>>;
}

/**
 * 衍生規則：`from` 的變更如何落到本資源。
 * - `self`：沿用 `change.id`（本資源的某一筆就是來源的那一筆）
 * - `ref`：取 `change.refs[本資源]`；呼叫端沒給就退回 `ANY_ID`
 * - `none`：只影響本資源的 collection
 */
export interface Derivation<R extends string> {
  from: R;
  /** 省略代表所有種類的變更都會影響。 */
  kinds?: readonly ChangeKind[];
  id: 'self' | 'ref' | 'none';
  /** 額外條件（例：只有「自己」被改才影響 profile）。 */
  when?: (change: ResourceChange<R>) => boolean;
}

interface ResourceKeys {
  /** 聚合多筆的查詢（列表、選項）：以 `[KEY]` 前綴失效。 */
  collection?: readonly string[];
  /** 單筆的查詢：key 第二個元素必須是 id，以 `[KEY, id]` 前綴失效。 */
  entity?: readonly string[];
}

/**
 * collection 中以「範圍」區分的查詢（key 第二個元素是範圍，例：檔案列表的資料夾）。
 * 本資源自己的變更帶了 `refs[ref]` 時，只失效 `[KEY, 範圍]` 與 `[KEY, unscoped]`（不分範圍的查詢）；
 * 沒帶、或是從其他來源衍生來的變更，照舊以 `[KEY]` 前綴全部失效。
 */
export interface ScopedCollection<R extends string> {
  keys: readonly string[];
  ref: R;
  /** 不分範圍的查詢放在 key 第二個元素的值。 */
  unscoped: string;
}

export interface ResourceDefinition<R extends string> extends ResourceKeys {
  derivesFrom?: readonly Derivation<R>[];
  /** 任何來源變更都會影響（例：稽核日誌）。只影響 collection。 */
  derivesFromAnyChange?: boolean;
  scopedCollection?: ScopedCollection<R>;
}

export type InvalidationAction = 'invalidate' | 'remove';

export interface InvalidationTarget {
  queryKey: readonly string[];
  action: InvalidationAction;
}

interface Rule<R extends string> {
  target: R;
  derivation: Derivation<R>;
}

export interface ResourceGraph<R extends string> {
  resolve(changes: readonly ResourceChange<R>[]): InvalidationTarget[];
}

export function createResourceGraph<R extends string>(
  definitions: Record<R, ResourceDefinition<R>>,
): ResourceGraph<R> {
  const resources = Object.keys(definitions) as R[];
  const rulesBySource = new Map<R, Rule<R>[]>();
  const anyChangeTargets: R[] = [];

  for (const target of resources) {
    const definition = definitions[target];
    if (definition.derivesFromAnyChange) anyChangeTargets.push(target);
    for (const derivation of definition.derivesFrom ?? []) {
      if (derivation.from === target) {
        throw new Error(`resource "${target}" 不能衍生自自己`);
      }
      const rules = rulesBySource.get(derivation.from) ?? [];
      rules.push({ target, derivation });
      rulesBySource.set(derivation.from, rules);
    }
  }

  return {
    resolve(changes) {
      const plan = new InvalidationPlan();
      for (const change of changes) {
        const definition = definitions[change.resource];
        plan.addOwn(definition, change.kind, change.id, scopesOf(definition, change));
        for (const { target, derivation } of rulesBySource.get(change.resource) ?? []) {
          if (derivation.kinds && !derivation.kinds.includes(change.kind)) continue;
          if (derivation.when && !derivation.when(change)) continue;
          for (const id of mapIds(derivation, change, target)) {
            plan.addDerived(definitions[target], id);
          }
        }
        for (const target of anyChangeTargets) {
          if (target !== change.resource) plan.addDerived(definitions[target], undefined);
        }
      }
      return plan.toTargets();
    },
  };
}

/** 本資源的變更落在哪些範圍（`ScopedCollection`）；undefined 代表不分範圍、全部失效。 */
function scopesOf<R extends string>(
  definition: ResourceDefinition<R>,
  change: ResourceChange<R>,
): { keys: readonly string[]; scopes: readonly string[] } | undefined {
  const scoped = definition.scopedCollection;
  const refs = scoped && change.refs?.[scoped.ref];
  if (!scoped || !refs) return undefined;
  return { keys: scoped.keys, scopes: [...refs, scoped.unscoped] };
}

function mapIds<R extends string>(
  derivation: Derivation<R>,
  change: ResourceChange<R>,
  target: R,
): readonly (string | undefined)[] {
  switch (derivation.id) {
    case 'self':
      return [change.id];
    case 'ref': {
      const ids = change.refs?.[target];
      return ids ? ids : [ANY_ID];
    }
    case 'none':
      return [undefined];
  }
}

/** 收集目標並去重：`[KEY]` 已失效時，`[KEY, id]` 的失效是多餘的。 */
class InvalidationPlan {
  private readonly prefixes = new Set<string>();
  /** 只失效某些範圍的 collection（`[KEY, 範圍]`）。 */
  private readonly scoped = new Map<string, Set<string>>();
  private readonly entities = new Map<string, Set<string>>();
  private readonly removals = new Map<string, Set<string>>();

  addOwn(
    definition: ResourceKeys,
    kind: ChangeKind,
    id: string | undefined,
    scope?: { keys: readonly string[]; scopes: readonly string[] },
  ): void {
    this.addCollection(definition, scope);
    if (kind === 'create' || id === undefined) return;
    if (kind === 'delete' && id !== ANY_ID) {
      for (const key of definition.entity ?? []) add(this.removals, key, id);
      return;
    }
    this.addEntity(definition, id);
  }

  addDerived(definition: ResourceKeys, id: string | undefined): void {
    this.addCollection(definition);
    if (id !== undefined) this.addEntity(definition, id);
  }

  private addCollection(
    definition: ResourceKeys,
    scope?: { keys: readonly string[]; scopes: readonly string[] },
  ): void {
    for (const key of definition.collection ?? []) {
      if (scope?.keys.includes(key)) {
        for (const value of scope.scopes) add(this.scoped, key, value);
      } else this.prefixes.add(key);
    }
  }

  private addEntity(definition: ResourceKeys, id: string): void {
    for (const key of definition.entity ?? []) {
      if (id === ANY_ID) this.prefixes.add(key);
      else add(this.entities, key, id);
    }
  }

  toTargets(): InvalidationTarget[] {
    const targets: InvalidationTarget[] = [];
    // 先移除再失效：被刪掉的那一筆不該被重新抓（會 404）
    for (const [key, ids] of this.removals) {
      for (const id of ids) targets.push({ queryKey: [key, id], action: 'remove' });
    }
    for (const key of this.prefixes) targets.push({ queryKey: [key], action: 'invalidate' });
    for (const [key, scopes] of this.scoped) {
      if (this.prefixes.has(key)) continue;
      for (const scope of scopes) targets.push({ queryKey: [key, scope], action: 'invalidate' });
    }
    for (const [key, ids] of this.entities) {
      if (this.prefixes.has(key)) continue;
      for (const id of ids) {
        if (this.removals.get(key)?.has(id)) continue;
        targets.push({ queryKey: [key, id], action: 'invalidate' });
      }
    }
    return targets;
  }
}

function add(map: Map<string, Set<string>>, key: string, id: string): void {
  const ids = map.get(key) ?? new Set<string>();
  ids.add(id);
  map.set(key, ids);
}
