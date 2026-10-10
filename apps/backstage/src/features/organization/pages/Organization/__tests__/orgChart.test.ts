import { describe, expect, it, vi } from 'vitest';

import type { OrgUnit } from '@/shared/api-sdk';

import {
  blankNodeIds,
  conflictingDeletes,
  countPlanChanges,
  createOrgChartNode,
  executeOrgChartPlan,
  hasOrgChartChanged,
  isNewNodeId,
  isWithinDepth,
  ORG_CHART_MAX_DEPTH,
  planOrgChartChanges,
  renameNode,
  toOrgChartValue,
} from '../orgChart';
import type { OrgChartApi, OrgChartValue } from '../orgChart';

const unit = (id: string, name: string, parentId: string | null, sortOrder = 0): OrgUnit => ({
  id,
  parentId,
  name,
  code: null,
  description: null,
  sortOrder,
  memberCount: 2,
  managerCount: 1,
  managers: [{ userId: `${id}-boss`, displayName: `${name}主管` }],
  version: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

// hq ─┬─ sales ── north
//     └─ rd
const UNITS = [
  unit('rd', '研發部', 'hq', 1),
  unit('north', '北區', 'sales'),
  unit('hq', '總公司', null),
  unit('sales', '業務部', 'hq', 0),
];

const withNode = (
  value: OrgChartValue,
  id: string,
  name: string,
  parent?: string,
): OrgChartValue => ({
  nodes: [...value.nodes, { id, data: { name, managers: [], memberCount: 0, isNew: true } }],
  edges: parent ? [...value.edges, { source: parent, target: id }] : value.edges,
});

const reparent = (value: OrgChartValue, id: string, parent: string | null): OrgChartValue => ({
  ...value,
  edges: [
    ...value.edges.filter((edge) => edge.target !== id),
    ...(parent ? [{ source: parent, target: id }] : []),
  ],
});

const removeNode = (value: OrgChartValue, id: string): OrgChartValue => ({
  nodes: value.nodes.filter((node) => node.id !== id),
  edges: value.edges.filter((edge) => edge.source !== id && edge.target !== id),
});

describe('toOrgChartValue', () => {
  it('同層依 sortOrder 排列，上層成為連線，主管只留名字', () => {
    const value = toOrgChartValue(UNITS);
    const order = value.nodes.map((node) => node.id);
    // 總公司底下：業務部（sortOrder 0）在研發部（1）之前
    expect(order.indexOf('sales')).toBeLessThan(order.indexOf('rd'));
    expect(value.edges).toEqual(
      expect.arrayContaining([
        { source: 'hq', target: 'sales' },
        { source: 'hq', target: 'rd' },
        { source: 'sales', target: 'north' },
      ]),
    );
    expect(value.nodes.find((node) => node.id === 'hq')?.data).toEqual({
      name: '總公司',
      managers: ['總公司主管'],
      memberCount: 2,
      isNew: false,
    });
  });

  it('上層不在清單裡 → 當作最上層', () => {
    const value = toOrgChartValue([unit('orphan', '孤兒', 'missing')]);
    expect(value.edges).toEqual([]);
  });
});

describe('createOrgChartNode', () => {
  it('每次產生不同的暫時 id，標為新節點', () => {
    const a = createOrgChartNode('新部門');
    const b = createOrgChartNode('新部門');
    expect(a.id).not.toBe(b.id);
    expect(isNewNodeId(a.id)).toBe(true);
    expect(isNewNodeId('hq')).toBe(false);
    expect(a.data).toEqual({ name: '新部門', managers: [], memberCount: 0, isNew: true });
  });
});

describe('planOrgChartChanges', () => {
  it('沒改任何東西 → 空計畫', () => {
    const plan = planOrgChartChanges(UNITS, toOrgChartValue(UNITS));
    expect(countPlanChanges(plan)).toBe(0);
  });

  it('新增：新的上層先於新的下層，上層參照分成既有與新的', () => {
    let draft = toOrgChartValue(UNITS);
    // 故意先加下層再加上層（節點順序不代表建立順序）
    draft = withNode(draft, 'new:child', ' 南區 ');
    draft = withNode(draft, 'new:parent', '海外', 'sales');
    draft = { ...draft, edges: [...draft.edges, { source: 'new:parent', target: 'new:child' }] };

    const plan = planOrgChartChanges(UNITS, draft);
    expect(plan.creates).toEqual([
      { tempId: 'new:parent', name: '海外', parent: { kind: 'existing', id: 'sales' } },
      { tempId: 'new:child', name: '南區', parent: { kind: 'new', tempId: 'new:parent' } },
    ]);
  });

  it('改名（去頭尾空白）與換上層', () => {
    let draft = renameNode(toOrgChartValue(UNITS), 'rd', ' 產品研發部 ');
    draft = reparent(draft, 'north', 'rd');
    draft = reparent(draft, 'sales', null);
    const plan = planOrgChartChanges(UNITS, draft);
    expect(plan.renames).toEqual([{ id: 'rd', name: '產品研發部' }]);
    expect(plan.moves).toEqual(
      expect.arrayContaining([
        { id: 'north', parent: { kind: 'existing', id: 'rd' } },
        { id: 'sales', parent: null },
      ]),
    );
    expect(plan.moves).toHaveLength(2);
  });

  it('既有部門搬到新部門底下', () => {
    let draft = withNode(toOrgChartValue(UNITS), 'new:x', '新事業處', 'hq');
    draft = reparent(draft, 'rd', 'new:x');
    expect(planOrgChartChanges(UNITS, draft).moves).toEqual([
      { id: 'rd', parent: { kind: 'new', tempId: 'new:x' } },
    ]);
  });

  it('刪除：伺服器上較深的先刪；留下的下層變成最上層（換上層）', () => {
    let draft = removeNode(toOrgChartValue(UNITS), 'hq');
    draft = removeNode(draft, 'sales');
    const plan = planOrgChartChanges(UNITS, draft);
    expect(plan.deletes).toEqual(['sales', 'hq']);
    expect(plan.moves).toEqual(
      expect.arrayContaining([
        { id: 'north', parent: null },
        { id: 'rd', parent: null },
      ]),
    );
  });

  it('新增後又刪掉的節點不出現在計畫裡', () => {
    const draft = removeNode(withNode(toOrgChartValue(UNITS), 'new:x', '暫時', 'hq'), 'new:x');
    expect(countPlanChanges(planOrgChartChanges(UNITS, draft))).toBe(0);
  });
});

describe('編輯期間伺服器的部門樹改變', () => {
  // 進入編輯模式時的樹是 UNITS；之後別人新增了「新專案組」、把業務部改名為「業務一部」（version 遞增）
  const LATEST = [
    ...UNITS.map((item) =>
      item.id === 'sales' ? { ...item, name: '業務一部', version: 4 } : item,
    ),
    unit('project', '新專案組', 'hq', 2),
  ];

  it('計畫以進入編輯時的樹計算：別人的新增與改名不會變成刪除、改回舊名', () => {
    const draft = toOrgChartValue(UNITS);
    expect(countPlanChanges(planOrgChartChanges(UNITS, draft))).toBe(0);
    // 對照：拿最新的樹比對會把別人的變更排進計畫（這就是要避免的情形）
    const wrong = planOrgChartChanges(LATEST, draft);
    expect(wrong.deletes).toEqual(['project']);
    expect(wrong.renames).toEqual([{ id: 'sales', name: '業務部' }]);
  });

  it('hasOrgChartChanged：部門增減或 version 改變', () => {
    expect(hasOrgChartChanged(UNITS, UNITS.toReversed())).toBe(false);
    expect(hasOrgChartChanged(UNITS, LATEST)).toBe(true);
    expect(hasOrgChartChanged(UNITS, UNITS.slice(1))).toBe(true);
    expect(
      hasOrgChartChanged(
        UNITS,
        UNITS.map((item) => (item.id === 'rd' ? { ...item, version: 4 } : item)),
      ),
    ).toBe(true);
  });

  it('conflictingDeletes：要刪的部門被改過、已刪除或多了下層', () => {
    const draft = removeNode(removeNode(toOrgChartValue(UNITS), 'north'), 'rd');
    const plan = planOrgChartChanges(UNITS, draft);
    expect(plan.deletes).toEqual(['north', 'rd']);
    expect(conflictingDeletes(plan, UNITS, UNITS)).toEqual([]);
    // 別人的改動與要刪的部門無關 → 不擋
    expect(conflictingDeletes(plan, UNITS, LATEST)).toEqual([]);

    const renamed = UNITS.map((item) => (item.id === 'rd' ? { ...item, version: 4 } : item));
    expect(conflictingDeletes(plan, UNITS, renamed)).toEqual(['rd']);
    const deleted = UNITS.filter((item) => item.id !== 'north');
    expect(conflictingDeletes(plan, UNITS, deleted)).toEqual(['north']);
    const newChild = [...UNITS, unit('rd-ai', 'AI 組', 'rd')];
    expect(conflictingDeletes(plan, UNITS, newChild)).toEqual(['rd']);
    // 既有部門被別人搬到要刪的部門底下（它自己的 version 變了、要刪的部門沒變）也要擋
    const movedIn = UNITS.map((item) =>
      item.id === 'sales' ? { ...item, parentId: 'rd', version: 4 } : item,
    );
    expect(conflictingDeletes(plan, UNITS, movedIn)).toEqual(['rd']);
  });
});

describe('blankNodeIds', () => {
  it('名稱只有空白的節點', () => {
    const draft = renameNode(withNode(toOrgChartValue(UNITS), 'new:x', '  ', 'hq'), 'rd', '');
    expect(blankNodeIds(draft).toSorted()).toEqual(['new:x', 'rd']);
  });
});

/** 一條長度為 n 的鏈：c1 ── c2 ── … ── cn。 */
const chain = (n: number, prefix = 'c'): OrgChartValue => ({
  nodes: Array.from({ length: n }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    data: { name: '', managers: [], memberCount: 0, isNew: false },
  })),
  edges: Array.from({ length: n - 1 }, (_, index) => ({
    source: `${prefix}${index + 1}`,
    target: `${prefix}${index + 2}`,
  })),
});

describe('isWithinDepth', () => {
  it('接上去後最深一層剛好等於上限 → 可以', () => {
    const value = {
      nodes: [...chain(8).nodes, ...chain(2, 'd').nodes],
      edges: [...chain(8).edges, ...chain(2, 'd').edges],
    };
    // c8 是第 8 層，d1 接上去是第 9 層、d2 第 10 層
    expect(isWithinDepth({ source: 'c8', target: 'd1' }, value)).toBe(true);
  });

  it('超過上限 → 不行', () => {
    const value = {
      nodes: [...chain(9).nodes, ...chain(2, 'd').nodes],
      edges: [...chain(9).edges, ...chain(2, 'd').edges],
    };
    expect(isWithinDepth({ source: 'c9', target: 'd1' }, value)).toBe(false);
    expect(ORG_CHART_MAX_DEPTH).toBe(10);
  });

  it('換上層時不把原本的連線算進去', () => {
    const value = chain(10);
    // c10 從 c9 底下搬到 c1 底下：變成第 2 層
    expect(isWithinDepth({ source: 'c1', target: 'c10' }, value)).toBe(true);
  });
});

/** 假的 API：`calls` 記錄呼叫順序；新增回傳 `server-1`、`server-2`…，改名把 version 加一。 */
function fakeApi() {
  const calls: string[] = [];
  let next = 0;
  const api = {
    create: vi.fn<OrgChartApi['create']>(async () => {
      calls.push('create');
      next += 1;
      return { id: `server-${next}` };
    }),
    rename: vi.fn<OrgChartApi['rename']>(async (_id, body) => {
      calls.push('rename');
      return { version: body.version + 1 };
    }),
    move: vi.fn<OrgChartApi['move']>(async () => {
      calls.push('move');
    }),
    remove: vi.fn<OrgChartApi['remove']>(async () => {
      calls.push('remove');
    }),
  };
  return { api, calls };
}

describe('executeOrgChartPlan', () => {
  it('依序新增 → 改名 → 搬移 → 刪除；新部門的 id 傳給下層，搬移用改名後的 version', async () => {
    let draft = withNode(toOrgChartValue(UNITS), 'new:a', '海外', 'hq');
    draft = withNode(draft, 'new:b', '日本', 'new:a');
    draft = renameNode(draft, 'north', '北北基');
    draft = reparent(draft, 'north', 'new:a');
    draft = removeNode(draft, 'rd');
    const plan = planOrgChartChanges(UNITS, draft);
    const { api, calls } = fakeApi();

    const failure = await executeOrgChartPlan(plan, UNITS, draft, api);

    expect(failure).toBeNull();
    expect(calls).toEqual(['create', 'create', 'rename', 'move', 'remove']);
    expect(api.create.mock.calls.map(([body]) => body)).toEqual([
      { name: '海外', parentId: 'hq' },
      { name: '日本', parentId: 'server-1' },
    ]);
    expect(api.rename).toHaveBeenCalledWith('north', { name: '北北基', version: 3 });
    expect(api.move).toHaveBeenCalledWith('north', { parentId: 'server-1', version: 4 });
    expect(api.remove).toHaveBeenCalledWith('rd');
  });

  it('某一步失敗就停，回報那一步與已完成的數量', async () => {
    let draft = renameNode(toOrgChartValue(UNITS), 'rd', '研發中心');
    draft = reparent(draft, 'north', null);
    draft = removeNode(draft, 'sales');
    const error = new Error('conflict');
    const { api } = fakeApi();
    api.move.mockRejectedValue(error);

    const failure = await executeOrgChartPlan(planOrgChartChanges(UNITS, draft), UNITS, draft, api);

    expect(failure).toEqual({ step: 'move', name: '北區', error, completed: 1 });
    expect(api.remove).not.toHaveBeenCalled();
  });
});
