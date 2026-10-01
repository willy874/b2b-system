/**
 * 關係圖的型別定義（docs/rbac/01-domain-model.md §6.4、docs/adr/0024-relationship-based-access-control.md）。
 * 語意是 Zanzibar／OpenFGA 的子集：直接、計算（`computed`）、`X from Y`（`from`）、聯集、交集、萬用字元。
 * **刻意不提供排除（`but not`）**：只有 allow（D4）。
 */

/**
 * 主體的寫法：`'user'`（節點本身）、`'user:*'`（該型別的所有節點）、`'role#holder'`（節點的某個關係＝使用者集合）。
 */
export type SubjectSpec = string;

export type Rewrite =
  | { readonly kind: 'direct'; readonly subjects: readonly SubjectSpec[] }
  | { readonly kind: 'computed'; readonly relation: string }
  | { readonly kind: 'from'; readonly tupleset: string; readonly relation: string }
  | { readonly kind: 'union'; readonly children: readonly Rewrite[] }
  | { readonly kind: 'intersection'; readonly children: readonly Rewrite[] };

export interface TypeDefinition {
  readonly name: string;
  readonly relations: Readonly<Record<string, Rewrite>>;
  /**
   * 這個型別上的「能力」：反提權比對的關係（docs/adr/0024-relationship-based-access-control.md G4）。
   * 寫入一條邊讓主體取得的能力，操作者必須全部都有（`capabilitiesOf`）。租戶上是每個權限鍵與 `superAdmin`、
   * 資料夾上是 `can_*`；等級（`editor`）、成員關係（`role#holder`）本身不是能力，是取得能力的途徑。
   */
  readonly capabilities?: readonly string[];
}

/** 可以直接寫進 tuple 的主體種類。 */
export function direct(...subjects: SubjectSpec[]): Rewrite {
  return { kind: 'direct', subjects };
}

/** 同一個物件的另一個關係（例：`editor` 含 `manager`）。 */
export function computed(relation: string): Rewrite {
  return { kind: 'computed', relation };
}

/** `relation from tupleset`：沿著 `tupleset` 走到另一個物件，看它的 `relation`（例：`viewer from inherits_from`）。 */
export function from(tupleset: string, relation: string): Rewrite {
  return { kind: 'from', tupleset, relation };
}

export function union(...children: Rewrite[]): Rewrite {
  return { kind: 'union', children };
}

/** 交集只用在「收窄的組合」（擁有者 ∧ 能在上層建立），不是否定規則。 */
export function and(...children: Rewrite[]): Rewrite {
  return { kind: 'intersection', children };
}

export function defineType(
  name: string,
  relations: Readonly<Record<string, Rewrite>>,
  options: { capabilities?: readonly string[] } = {},
): TypeDefinition {
  return options.capabilities
    ? { name, relations, capabilities: options.capabilities }
    : { name, relations };
}

/** 已驗證的模型：型別名稱 → 定義。 */
export interface AuthzModel {
  readonly types: ReadonlyMap<string, TypeDefinition>;
}

interface ParsedSubject {
  type: string;
  relation: string | undefined;
  wildcard: boolean;
}

export function parseSubjectSpec(spec: SubjectSpec): ParsedSubject {
  const [typePart = '', relation] = spec.split('#');
  const wildcard = typePart.endsWith(':*');
  return { type: wildcard ? typePart.slice(0, -2) : typePart, relation, wildcard };
}

function walk(rewrite: Rewrite, visit: (node: Rewrite) => void): void {
  visit(rewrite);
  if (rewrite.kind === 'union' || rewrite.kind === 'intersection') {
    for (const child of rewrite.children) walk(child, visit);
  }
}

/**
 * 建立模型並驗證；違反時丟出列出所有問題的錯誤（啟動時就失敗，比照路由稽核）：
 * 引用的型別與關係存在、`from` 的 tupleset 是直接關係、同一個型別內的 `computed` 沒有循環。
 */
export function createModel(definitions: readonly TypeDefinition[]): AuthzModel {
  const types = new Map<string, TypeDefinition>();
  const errors: string[] = [];
  for (const definition of definitions) {
    if (types.has(definition.name)) errors.push(`型別 ${definition.name} 重複定義`);
    types.set(definition.name, definition);
  }

  for (const type of types.values()) {
    for (const [relation, rewrite] of Object.entries(type.relations)) {
      const where = `${type.name}#${relation}`;
      walk(rewrite, (node) => {
        if (node.kind === 'direct') {
          for (const spec of node.subjects) {
            const subject = parseSubjectSpec(spec);
            const target = types.get(subject.type);
            if (!target) errors.push(`${where}：主體型別 ${subject.type} 不存在`);
            else if (subject.relation && !(subject.relation in target.relations)) {
              errors.push(`${where}：主體關係 ${spec} 不存在`);
            }
          }
        } else if (node.kind === 'computed') {
          if (!(node.relation in type.relations)) {
            errors.push(`${where}：computed 關係 ${node.relation} 不存在`);
          }
        } else if (node.kind === 'from') {
          const tupleset = type.relations[node.tupleset];
          if (!tupleset) errors.push(`${where}：tupleset ${node.tupleset} 不存在`);
          else if (tupleset.kind !== 'direct') {
            errors.push(`${where}：tupleset ${node.tupleset} 必須是直接關係`);
          }
        }
      });
    }

    for (const capability of type.capabilities ?? []) {
      if (!(capability in type.relations)) {
        errors.push(`${type.name}：能力 ${capability} 不是這個型別的關係`);
      }
    }

    // computed 循環：同一個物件上的關係互相引用，沒有任何邊能讓它成立
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (relation: string, path: string[]): void => {
      if (done.has(relation)) return;
      if (visiting.has(relation)) {
        errors.push(`${type.name}：computed 形成循環 ${[...path, relation].join(' → ')}`);
        return;
      }
      visiting.add(relation);
      const rewrite = type.relations[relation];
      if (rewrite) {
        walk(rewrite, (node) => {
          if (node.kind === 'computed') visit(node.relation, [...path, relation]);
        });
      }
      visiting.delete(relation);
      done.add(relation);
    };
    for (const relation of Object.keys(type.relations)) visit(relation, []);
  }

  if (errors.length) {
    throw new Error(
      '權限模型定義錯誤（core/authz）：\n' + errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
  return { types };
}

/**
 * 靜態蘊含：屬於 `relation` 就一定屬於的關係（含自己），只沿 `computed` ／聯集推導。
 * 例：`impliedRelations(model, 'fileFolder', 'editor')` 含 `viewer`、`can_update`。
 * 資料夾等級的反提權（等級蘊含哪些動作）與權限依賴閉包都靠它。
 */
export function impliedRelations(model: AuthzModel, type: string, relation: string): Set<string> {
  const definition = model.types.get(type);
  const result = new Set<string>([relation]);
  if (!definition) return result;

  const memo = new Map<string, boolean>();
  // `candidate` 的定義是否（在任何物件上）一定涵蓋 `relation`
  const covers = (rewrite: Rewrite, seen: ReadonlySet<string>): boolean => {
    switch (rewrite.kind) {
      case 'computed':
        return rewrite.relation === relation || coversRelation(rewrite.relation, seen);
      case 'union':
        return rewrite.children.some((child) => covers(child, seen));
      case 'intersection':
        return rewrite.children.every((child) => covers(child, seen));
      default:
        return false;
    }
  };
  const coversRelation = (candidate: string, seen: ReadonlySet<string>): boolean => {
    if (candidate === relation) return true;
    const cached = memo.get(candidate);
    if (cached !== undefined) return cached;
    if (seen.has(candidate)) return false;
    const rewrite = definition.relations[candidate];
    const value = rewrite ? covers(rewrite, new Set([...seen, candidate])) : false;
    memo.set(candidate, value);
    return value;
  };

  for (const candidate of Object.keys(definition.relations)) {
    if (coversRelation(candidate, new Set())) result.add(candidate);
  }
  return result;
}

/**
 * 成為 `type#relation` 的主體時，在 **同一個物件** 上取得的能力（反提權用；docs/adr/0024-relationship-based-access-control.md G4）。
 * 關係本身是能力（租戶上的權限鍵）→ 只有它（它蘊含的鍵由操作者的閉包自然涵蓋）；
 * 否則是它靜態蘊含的能力（資料夾等級 → `can_*`），依型別宣告的能力順序。
 * 成員關係（`role#holder`、`group#member`）帶來的是別的物件上的能力，要沿著邊展開，見 `AuthzService.grantedCapabilities`。
 */
export function capabilitiesOf(model: AuthzModel, type: string, relation: string): string[] {
  const capabilities = model.types.get(type)?.capabilities ?? [];
  if (capabilities.includes(relation)) return [relation];
  const implied = impliedRelations(model, type, relation);
  return capabilities.filter((capability) => implied.has(capability));
}

/** `type#relation` 是否是使用者集合：模型裡有直接關係允許它當主體（例：`role#holder`、`group#member`）。 */
export function isUsersetRelation(model: AuthzModel, type: string, relation: string): boolean {
  const spec = `${type}#${relation}`;
  for (const definition of model.types.values()) {
    for (const rewrite of Object.values(definition.relations)) {
      let found = false;
      walk(rewrite, (node) => {
        if (node.kind === 'direct' && node.subjects.includes(spec)) found = true;
      });
      if (found) return true;
    }
  }
  return false;
}

/** 要寫進 `relation_tuples` 的一條邊（欄位與表相同）。 */
export interface TupleShape {
  objectType: string;
  relation: string;
  subjectType: string;
  subjectId: string;
  subjectRelation?: string | null;
}

/**
 * 寫入時的模型驗證：型別有這個關係、而且是可以直接寫的（定義裡有 `direct`）、主體的種類是那個 `direct` 允許的。
 * 回傳違反的說明；合法時回 undefined。
 */
export function validateTuple(model: AuthzModel, tuple: TupleShape): string | undefined {
  const where = `${tuple.objectType}#${tuple.relation}`;
  const definition = model.types.get(tuple.objectType);
  if (!definition) return `${where}：型別 ${tuple.objectType} 不存在`;
  const rewrite = definition.relations[tuple.relation];
  if (!rewrite) return `${where}：關係不存在`;
  const allowed: SubjectSpec[] = [];
  walk(rewrite, (node) => {
    if (node.kind === 'direct') allowed.push(...node.subjects);
  });
  if (!allowed.length) return `${where}：不是直接關係，不能寫入`;
  const subjectRelation = tuple.subjectRelation ?? '';
  const ok = allowed.some((spec) => {
    const subject = parseSubjectSpec(spec);
    if (subject.type !== tuple.subjectType) return false;
    if (subject.wildcard) return tuple.subjectId === '*' && !subjectRelation;
    if (tuple.subjectId === '*') return false;
    return (subject.relation ?? '') === subjectRelation;
  });
  const subject = `${tuple.subjectType}:${tuple.subjectId}${subjectRelation ? `#${subjectRelation}` : ''}`;
  return ok ? undefined : `${where}：主體 ${subject} 不在允許的種類（${allowed.join('、')}）`;
}
