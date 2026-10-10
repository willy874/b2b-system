import type { TreeEditorEdge, TreeEditorNode, TreeEditorValue } from '@b2b-system/ui/TreeEditor';

import type { OrgUnit } from '@/shared/api-sdk';

/**
 * 組織圖的資料與編輯計畫（docs/architecture/backend/23-organization.md §8）：純函式，不碰 React 與 API，方便單元測試。
 *
 * 編輯模式在畫布上改的是一份草稿（`TreeEditorValue`）；按「儲存」時比對草稿與進入編輯模式時的部門樹，
 * 算出要依序呼叫的 API：新增 → 改名 → 搬移 → 刪除。
 */

/** 部門樹的層數上限（與後端 `ORG_UNIT_MAX_DEPTH` 相同，最上層算第 1 層）。 */
export const ORG_CHART_MAX_DEPTH = 10;

/** 新節點的 id 前綴：儲存前還沒有伺服器的 id。 */
const NEW_PREFIX = 'new:';

export interface OrgChartNodeData {
  name: string;
  /** 主管的名字；新節點沒有。 */
  managers: string[];
  memberCount: number;
  /** 草稿裡新增、還沒存到伺服器的部門。 */
  isNew: boolean;
}

export type OrgChartValue = TreeEditorValue<OrgChartNodeData>;
export type OrgChartNode = TreeEditorNode<OrgChartNodeData>;

/** 伺服器上的部門 → 畫布的值；同層依 `sortOrder`、名稱排列（自動排版依節點順序）。 */
export function toOrgChartValue(units: readonly OrgUnit[]): OrgChartValue {
  const ordered = units.toSorted(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const ids = new Set(ordered.map((unit) => unit.id));
  return {
    nodes: ordered.map((unit) => ({
      id: unit.id,
      data: {
        name: unit.name,
        managers: unit.managers.map((manager) => manager.displayName),
        memberCount: unit.memberCount,
        isNew: false,
      },
    })),
    // 上層不在清單裡（理論上不會發生）時當作最上層
    edges: ordered.flatMap((unit) =>
      unit.parentId && ids.has(unit.parentId) ? [{ source: unit.parentId, target: unit.id }] : [],
    ),
  };
}

let sequence = 0;

/** 畫布上新增的部門（TreeEditor 的 `createNode`）。 */
export function createOrgChartNode(name: string): OrgChartNode {
  sequence += 1;
  return {
    id: `${NEW_PREFIX}${Date.now().toString(36)}-${sequence}`,
    data: { name, managers: [], memberCount: 0, isNew: true },
  };
}

export function isNewNodeId(id: string): boolean {
  return id.startsWith(NEW_PREFIX);
}

function parentMap(edges: readonly TreeEditorEdge[]): Map<string, string> {
  return new Map(edges.map((edge) => [edge.target, edge.source]));
}

/** 節點的層數（最上層 = 1）。 */
function depthOf(id: string, parents: ReadonlyMap<string, string>): number {
  let depth = 1;
  let current = parents.get(id);
  const seen = new Set([id]);
  while (current && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = parents.get(current);
  }
  return depth;
}

/** 子樹的高度（只有自己 = 0）。 */
function heightOf(id: string, edges: readonly TreeEditorEdge[]): number {
  const children = edges.filter((edge) => edge.source === id).map((edge) => edge.target);
  return children.length ? 1 + Math.max(...children.map((child) => heightOf(child, edges))) : 0;
}

/**
 * 連線（換上層）後最深的一層不能超過上限：上層的層數 ＋ 1 ＋ 子樹的高度。
 * 循環、自己連自己已由 TreeEditor 擋下；超過層數的後端也會回 409，這裡先擋，拖不上去比存了才失敗清楚。
 */
export function isWithinDepth(edge: TreeEditorEdge, value: OrgChartValue): boolean {
  const edges = value.edges.filter((existing) => existing.target !== edge.target);
  const parents = parentMap(edges);
  return depthOf(edge.source, parents) + 1 + heightOf(edge.target, edges) <= ORG_CHART_MAX_DEPTH;
}

/** 上層的參照：既有部門的 id，或同一次儲存裡新增的部門。 */
export type OrgChartParentRef = { kind: 'existing'; id: string } | { kind: 'new'; tempId: string };

export interface OrgChartPlan {
  /** 依上層先於下層的順序。 */
  creates: Array<{ tempId: string; name: string; parent: OrgChartParentRef | null }>;
  renames: Array<{ id: string; name: string }>;
  moves: Array<{ id: string; parent: OrgChartParentRef | null }>;
  /** 下層先於上層（後端不能刪除還有下層的部門）。 */
  deletes: string[];
}

function refOf(id: string | undefined): OrgChartParentRef | null {
  if (!id) return null;
  return isNewNodeId(id) ? { kind: 'new', tempId: id } : { kind: 'existing', id };
}

/**
 * 比對 **進入編輯模式時** 的部門樹（`base`）與草稿，算出要依序呼叫的 API。
 * 不能用伺服器上最新的樹：編輯期間別人新增的部門不在草稿裡會被排進刪除，別人改的名稱、上層會被排成改回去。
 */
export function planOrgChartChanges(base: readonly OrgUnit[], draft: OrgChartValue): OrgChartPlan {
  const parents = parentMap(draft.edges);
  const draftIds = new Set(draft.nodes.map((node) => node.id));
  const byId = new Map(base.map((unit) => [unit.id, unit]));

  // 新增：沿上層往下的順序（上層是新的也要先建）
  const newNodes = draft.nodes.filter((node) => node.data.isNew);
  const creates = newNodes
    .map((node) => ({ node, depth: depthOf(node.id, parents) }))
    .toSorted((a, b) => a.depth - b.depth)
    .map(({ node }) => ({
      tempId: node.id,
      name: node.data.name.trim(),
      parent: refOf(parents.get(node.id)),
    }));

  const renames: OrgChartPlan['renames'] = [];
  const moves: OrgChartPlan['moves'] = [];
  for (const node of draft.nodes) {
    const original = byId.get(node.id);
    if (!original) continue;
    const name = node.data.name.trim();
    if (name !== original.name) renames.push({ id: node.id, name });
    const parentId = parents.get(node.id) ?? null;
    if (parentId !== original.parentId)
      moves.push({ id: node.id, parent: refOf(parentId ?? undefined) });
  }

  // 刪除：伺服器上的深度大的先刪（同一次刪除的上下層，下層先走）
  const originalParents = new Map(
    base.flatMap((unit) => (unit.parentId ? [[unit.id, unit.parentId] as const] : [])),
  );
  const deletes = base
    .filter((unit) => !draftIds.has(unit.id))
    .map((unit) => ({ id: unit.id, depth: depthOf(unit.id, originalParents) }))
    .toSorted((a, b) => b.depth - a.depth)
    .map(({ id }) => id);

  return { creates, renames, moves, deletes };
}

/** 進入編輯模式之後，伺服器上的部門樹是否被別人改過：部門增減，或任何一個的 `version` 改變。 */
export function hasOrgChartChanged(base: readonly OrgUnit[], units: readonly OrgUnit[]): boolean {
  if (base.length !== units.length) return true;
  const versions = new Map(base.map((unit) => [unit.id, unit.version]));
  return units.some((unit) => versions.get(unit.id) !== unit.version);
}

/**
 * 計畫要刪除、但進入編輯模式之後被別人改過的部門：已被刪除、`version` 改變，或多了不在 `base` 裡的下層。
 * 改名與換上層帶 `version`，由後端的樂觀鎖擋；刪除不帶，要在送出前自己擋，否則會刪掉別人剛改過的部門。
 */
export function conflictingDeletes(
  plan: OrgChartPlan,
  base: readonly OrgUnit[],
  units: readonly OrgUnit[],
): string[] {
  const baseById = new Map(base.map((unit) => [unit.id, unit]));
  const currentById = new Map(units.map((unit) => [unit.id, unit]));
  return plan.deletes.filter((id) => {
    const current = currentById.get(id);
    if (!current || current.version !== baseById.get(id)?.version) return true;
    return units.some((unit) => unit.parentId === id && baseById.get(unit.id)?.parentId !== id);
  });
}

export function countPlanChanges(plan: OrgChartPlan): number {
  return plan.creates.length + plan.renames.length + plan.moves.length + plan.deletes.length;
}

/** 草稿裡名稱空白的節點（儲存前擋下）。 */
export function blankNodeIds(draft: OrgChartValue): string[] {
  return draft.nodes.filter((node) => !node.data.name.trim()).map((node) => node.id);
}

/** 改一個節點的名稱（回傳新的一份值，給受控的 TreeEditor）。 */
export function renameNode(value: OrgChartValue, id: string, name: string): OrgChartValue {
  return {
    ...value,
    nodes: value.nodes.map((node) =>
      node.id === id ? { ...node, data: { ...node.data, name } } : node,
    ),
  };
}

/** 執行計畫要用到的 API（注入，測試時換成假的）。 */
export interface OrgChartApi {
  create: (body: { name: string; parentId: string | null }) => Promise<{ id: string }>;
  rename: (id: string, body: { name: string; version: number }) => Promise<{ version: number }>;
  move: (id: string, body: { parentId: string | null; version: number }) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}

/** 執行到哪一步失敗（前面的步驟已經生效）。 */
export interface OrgChartSaveFailure {
  step: 'create' | 'rename' | 'move' | 'delete';
  /** 那一步的部門名稱。 */
  name: string;
  error: unknown;
  /** 失敗前已完成幾步。 */
  completed: number;
}

/**
 * 依序執行計畫：新增 → 改名 → 搬移 → 刪除。每一步各自是一次 API 呼叫（後端沒有批次端點），
 * 遇到錯誤就停，回報失敗的那一步；前面的步驟已經生效（呼叫端重新取得部門樹）。
 * `version` 取自進入編輯模式時的部門樹（`base`）：別人在編輯期間改過的部門會 409。
 * 改名會遞增 `version`，同一個部門之後的搬移用改名回來的版本。
 */
export async function executeOrgChartPlan(
  plan: OrgChartPlan,
  base: readonly OrgUnit[],
  draft: OrgChartValue,
  api: OrgChartApi,
): Promise<OrgChartSaveFailure | null> {
  const versions = new Map(base.map((unit) => [unit.id, unit.version]));
  // 失敗訊息裡的名稱：既有部門用伺服器上的名稱（改名失敗時使用者認得的是舊名），新部門用草稿的名稱
  const names = new Map([
    ...draft.nodes.map((node) => [node.id, node.data.name] as const),
    ...base.map((unit) => [unit.id, unit.name] as const),
  ]);
  const created = new Map<string, string>();
  const resolve = (ref: OrgChartParentRef | null): string | null =>
    ref ? (ref.kind === 'existing' ? ref.id : (created.get(ref.tempId) ?? null)) : null;

  let completed = 0;
  const step = async (
    kind: OrgChartSaveFailure['step'],
    id: string,
    run: () => Promise<void>,
  ): Promise<OrgChartSaveFailure | null> => {
    try {
      await run();
      completed += 1;
      return null;
    } catch (error) {
      return { step: kind, name: names.get(id) ?? id, error, completed };
    }
  };

  for (const item of plan.creates) {
    // oxlint-disable-next-line no-await-in-loop -- 依序：下層的新增要等上層建好拿到 id
    const failure = await step('create', item.tempId, async () => {
      const unit = await api.create({ name: item.name, parentId: resolve(item.parent) });
      created.set(item.tempId, unit.id);
    });
    if (failure) return failure;
  }
  for (const item of plan.renames) {
    // oxlint-disable-next-line no-await-in-loop -- 依序：每一步失敗就停
    const failure = await step('rename', item.id, async () => {
      const unit = await api.rename(item.id, {
        name: item.name,
        version: versions.get(item.id) ?? 1,
      });
      versions.set(item.id, unit.version);
    });
    if (failure) return failure;
  }
  for (const item of plan.moves) {
    // oxlint-disable-next-line no-await-in-loop -- 同上
    const failure = await step('move', item.id, async () => {
      await api.move(item.id, {
        parentId: resolve(item.parent),
        version: versions.get(item.id) ?? 1,
      });
    });
    if (failure) return failure;
  }
  for (const id of plan.deletes) {
    // oxlint-disable-next-line no-await-in-loop -- 同上：下層先刪
    const failure = await step('delete', id, () => api.remove(id).then(() => undefined));
    if (failure) return failure;
  }
  return null;
}
