/**
 * 部門樹的純函式：`GET /org-units` 回的是扁平陣列（帶 `parentId`），由前端組回樹
 * （docs/architecture/backend/23-organization.md §5）。組織頁的左側樹與部門選擇器共用。
 */

/** 組樹需要的欄位；`OrgUnit` 可以直接傳進來。 */
export interface OrgUnitTreeSource {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  sortOrder: number;
}

export interface OrgUnitTreeNode<T extends OrgUnitTreeSource = OrgUnitTreeSource> {
  unit: T;
  /** 最上層是 0。 */
  depth: number;
  children: Array<OrgUnitTreeNode<T>>;
}

/** 同層的排序：先依 `sortOrder`，相同時依名稱（後端的排序值可能重複）。 */
function compareUnits(a: OrgUnitTreeSource, b: OrgUnitTreeSource): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * 依 `parentId` 組成樹。上層不在清單裡的部門（關鍵字篩選後的結果、或資料暫時不一致）當成最上層，不丟掉。
 */
export function buildOrgUnitTree<T extends OrgUnitTreeSource>(
  units: readonly T[],
): Array<OrgUnitTreeNode<T>> {
  const ids = new Set(units.map((unit) => unit.id));
  const childrenOf = new Map<string | null, T[]>();
  for (const unit of units) {
    const parent = unit.parentId !== null && ids.has(unit.parentId) ? unit.parentId : null;
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(unit);
    else childrenOf.set(parent, [unit]);
  }
  const build = (parent: string | null, depth: number): Array<OrgUnitTreeNode<T>> =>
    (childrenOf.get(parent) ?? [])
      .toSorted(compareUnits)
      .map((unit) => ({ unit, depth, children: build(unit.id, depth + 1) }));
  return build(null, 0);
}

/** 名稱或代碼包含關鍵字（不分大小寫）。 */
export function matchesOrgUnit(unit: OrgUnitTreeSource, keyword: string): boolean {
  const needle = keyword.trim().toLocaleLowerCase();
  if (!needle) return true;
  return (
    unit.name.toLocaleLowerCase().includes(needle) ||
    (unit.code?.toLocaleLowerCase().includes(needle) ?? false)
  );
}

/** 某個部門的所有上層 id（由近到遠）；找不到或已在最上層時是空陣列。 */
export function orgUnitAncestorIds(
  units: readonly OrgUnitTreeSource[],
  unitId: string | null | undefined,
): string[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const result: string[] = [];
  const seen = new Set<string>();
  let current = unitId ? byId.get(unitId)?.parentId : null;
  // `seen` 防禦資料暫時不一致時形成的環
  while (current && !seen.has(current)) {
    seen.add(current);
    result.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return result;
}

/** 部門本身與它所有下層的 id（搬移時不能選的目的地）。 */
export function orgUnitSubtreeIds(
  units: readonly OrgUnitTreeSource[],
  unitId: string,
): Set<string> {
  const result = new Set([unitId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const unit of units) {
      if (unit.parentId !== null && result.has(unit.parentId) && !result.has(unit.id)) {
        result.add(unit.id);
        grew = true;
      }
    }
  }
  return result;
}

/** 關鍵字篩選：留下符合的部門與它們的上層（樹才接得起來）。與後端 `GET /org-units?keyword=` 的語意相同。 */
export function filterOrgUnits<T extends OrgUnitTreeSource>(
  units: readonly T[],
  keyword: string,
): T[] {
  if (!keyword.trim()) return [...units];
  const keep = new Set<string>();
  for (const unit of units) {
    if (!matchesOrgUnit(unit, keyword)) continue;
    keep.add(unit.id);
    for (const id of orgUnitAncestorIds(units, unit.id)) keep.add(id);
  }
  return units.filter((unit) => keep.has(unit.id));
}
