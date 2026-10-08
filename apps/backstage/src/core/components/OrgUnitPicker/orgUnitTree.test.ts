import { describe, expect, it } from 'vitest';

import {
  buildOrgUnitTree,
  filterOrgUnits,
  orgUnitAncestorIds,
  orgUnitSubtreeIds,
} from './orgUnitTree';
import type { OrgUnitTreeNode, OrgUnitTreeSource } from './orgUnitTree';

const unit = (
  id: string,
  parentId: string | null,
  sortOrder = 0,
  code: string | null = null,
): OrgUnitTreeSource => ({ id, parentId, name: id, code, sortOrder });

// 總公司 ─┬─ 業務部 ── 北區
//         └─ 研發部
// 子公司
const UNITS = [
  unit('研發部', '總公司', 2, 'RD'),
  unit('北區', '業務部', 0),
  unit('總公司', null, 0, 'HQ'),
  unit('業務部', '總公司', 1, 'SALES'),
  unit('子公司', null, 1),
];

/** 樹 → 「縮排 ＋ 名稱」的清單，方便一眼比對形狀。 */
const flatten = (nodes: OrgUnitTreeNode[]): string[] =>
  nodes.flatMap((node) => [
    `${'-'.repeat(node.depth)}${node.unit.name}`,
    ...flatten(node.children),
  ]);

describe('buildOrgUnitTree（docs/architecture/backend/23-organization.md §5：扁平陣列由前端組回樹）', () => {
  it('依 parentId 組成樹，同層依 sortOrder 排序', () => {
    expect(flatten(buildOrgUnitTree(UNITS))).toEqual([
      '總公司',
      '-業務部',
      '--北區',
      '-研發部',
      '子公司',
    ]);
  });

  it('上層不在清單裡的部門當成最上層，不丟掉', () => {
    expect(flatten(buildOrgUnitTree([unit('北區', '業務部')]))).toEqual(['北區']);
  });
});

describe('orgUnitAncestorIds／orgUnitSubtreeIds', () => {
  it.each([
    ['北區', ['業務部', '總公司']],
    ['總公司', []],
    ['不存在', []],
  ])('%s 的上層 → %j', (id, expected) => {
    expect(orgUnitAncestorIds(UNITS, id)).toEqual(expected);
  });

  it('子樹含自己與所有下層', () => {
    expect(orgUnitSubtreeIds(UNITS, '總公司')).toEqual(
      new Set(['總公司', '業務部', '北區', '研發部']),
    );
  });
});

describe('filterOrgUnits', () => {
  it('留下符合的部門與它們的上層', () => {
    expect(filterOrgUnits(UNITS, '北').map((item) => item.id)).toEqual([
      '北區',
      '總公司',
      '業務部',
    ]);
  });

  it('代碼也比對，不分大小寫', () => {
    expect(filterOrgUnits(UNITS, 'rd').map((item) => item.id)).toEqual(['研發部', '總公司']);
  });

  it('空白關鍵字：全部保留', () => {
    expect(filterOrgUnits(UNITS, '  ')).toHaveLength(UNITS.length);
  });
});
