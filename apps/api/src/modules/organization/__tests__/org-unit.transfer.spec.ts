import type { ResourceChangeWire } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Transaction } from '@/core/database';
import type { DataTransferRegistry } from '@/modules/data-transfer/data-transfer-registry.service';
import type {
  AnyTransferResource,
  ResolvedRow,
  TransferContext,
} from '@/modules/data-transfer/data-transfer.types';

import type {
  OrgUnitMembershipRow,
  OrgUnitRepository,
  OrgUnitWithCounts,
} from '../org-unit.repository';
import type { OrgUnitAfterCommit, OrgUnitService } from '../org-unit.service';
import type { OrgUnitExportRow, OrgUnitMemberExportRow } from '../org-unit.transfer';
import { OrgUnitTransferResource } from '../org-unit.transfer';

function uid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const ACTOR_ID = uid(9000);
const ACTOR = { id: ACTOR_ID, email: 'admin@example.com' } as AuthUser;
const CTX = { actor: ACTOR } as TransferContext;
const TX = { tx: true } as unknown as Transaction;

const HQ = uid(1);
const SALES = uid(2);
const NORTH = uid(3);
const RD = uid(4);
const ORPHAN = uid(5);
const DELETED_PARENT = uid(99);

const ALICE = uid(1001);
const BOB = uid(1002);

function unit(id: string, overrides: Partial<OrgUnitWithCounts> = {}): OrgUnitWithCounts {
  return {
    id,
    parentId: null,
    name: `部門 ${id.slice(-4)}`,
    code: null,
    description: null,
    sortOrder: 0,
    version: 1,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    createdBy: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
    memberCount: 0,
    managerCount: 0,
    managers: [],
    ...overrides,
  } as OrgUnitWithCounts;
}

/** 總部(HQ) ─ 業務部(SALES) ─ 北區；總部 ─ 研發部；上層已刪除的「北區」當成最上層。 */
function sampleTree(): OrgUnitWithCounts[] {
  return [
    unit(HQ, { name: '總部', code: 'HQ', memberCount: 3 }),
    unit(SALES, { name: '業務部', code: 'SALES', parentId: HQ }),
    unit(NORTH, { name: '北區', parentId: SALES }),
    unit(RD, { name: '研發部', parentId: HQ }),
    unit(ORPHAN, { name: '北區', parentId: DELETED_PARENT }),
  ];
}

function member(
  unitId: string,
  userId: string,
  overrides: Partial<OrgUnitMembershipRow> = {},
): OrgUnitMembershipRow {
  return {
    unitId,
    userId,
    email: `${userId.slice(-4)}@example.com`,
    displayName: `使用者 ${userId.slice(-4)}`,
    isManager: false,
    isPrimary: false,
    title: null,
    ...overrides,
  };
}

const CHANGE = { resource: 'orgUnit', kind: 'update', id: HQ } as unknown as ResourceChangeWire;
const AFTER: OrgUnitAfterCommit = { changes: [CHANGE], affectedUserIds: [ALICE] };
const EFFECT = { kind: 'resourceChanged', change: CHANGE, affectedUserIds: [ALICE] };

function setup(units: OrgUnitWithCounts[] = sampleTree(), members: OrgUnitMembershipRow[] = []) {
  const resources = new Map<string, AnyTransferResource>();
  const registry = {
    register: vi.fn((resource: AnyTransferResource) => resources.set(resource.type, resource)),
  };
  const repo = {
    listAll: vi.fn(async () => units),
    matchKeyword: vi.fn(async (_keyword: string): Promise<string[]> => []),
    findTakenCodes: vi.fn(async (_values: readonly string[]) => new Set<string>(['hq'])),
    membersOfUnits: vi.fn(async (unitIds: readonly string[]) =>
      // 故意倒序回傳：驗證依組織樹排序
      members.filter((row) => unitIds.includes(row.unitId)).toReversed(),
    ),
    findMemberships: vi.fn(
      async (_pairs: ReadonlyArray<{ unitId: string; userId: string }>) =>
        new Map<string, OrgUnitMembershipRow>(),
    ),
    findActiveUsersByEmails: vi.fn(
      async (_values: readonly string[]): Promise<Array<{ id: string; email: string }>> => [],
    ),
    searchActiveUsers: vi.fn(async (_keyword: string, _limit: number) => [
      { id: ALICE, email: 'alice@example.com', displayName: 'Alice' },
    ]),
  };
  const service = {
    createInTx: vi.fn(async () => ({ unit: unit(uid(500)), after: AFTER })),
    updateInTx: vi.fn(async () => ({ unit: unit(HQ, { version: 7 }), after: AFTER })),
    moveInTx: vi.fn(async () => ({ unit: unit(HQ, { version: 8 }), after: AFTER })),
    updateMembersInTx: vi.fn(
      async (_unitId: string, _dto: unknown, _actor: AuthUser, _tx: unknown) => ({ after: AFTER }),
    ),
  };
  const transfer = new OrgUnitTransferResource(
    registry as unknown as DataTransferRegistry,
    repo as unknown as OrgUnitRepository,
    service as unknown as OrgUnitService,
  );
  transfer.onModuleInit();
  const units$ = resources.get('orgUnit');
  const members$ = resources.get('orgUnitMember');
  if (!units$?.exporter || !units$.importer || !members$?.exporter || !members$.importer) {
    throw new Error('資源沒有登記完整');
  }
  return {
    registry,
    repo,
    service,
    unitResource: units$,
    unitExporter: units$.exporter,
    unitImporter: units$.importer,
    memberResource: members$,
    memberExporter: members$.exporter,
    memberImporter: members$.importer,
  };
}

function column(resource: AnyTransferResource, key: string) {
  const found = resource.columns.find((item) => item.key === key);
  if (!found) throw new Error(`沒有欄位 ${key}`);
  return found;
}

function reference(resource: AnyTransferResource, key: string) {
  const spec = column(resource, key).reference;
  if (!spec) throw new Error(`${key} 不是參照欄`);
  return spec;
}

async function collect<T>(iterable: AsyncIterable<readonly T[]>): Promise<T[][]> {
  const pages: T[][] = [];
  for await (const page of iterable) pages.push([...page]);
  return pages;
}

function target(record: unknown, id: string) {
  return { id, label: id, version: 1, record };
}

/** 比對到的部門（與匯出的列相同形狀）。 */
async function exportRow(id: string): Promise<OrgUnitExportRow> {
  const { unitImporter } = setup();
  const found = await unitImporter.findTargetsById?.([id], CTX);
  return found?.get(id)?.record as OrgUnitExportRow;
}

function alreadyExists(value: string) {
  return [{ column: 'name', code: 'alreadyExists', params: { value }, severity: 'error' }];
}

function createRow(rowNo: number, values: Record<string, unknown>): ResolvedRow {
  return { rowNo, values };
}

/** 修改模式的成員列：目標是 `部門 id:使用者 id`。 */
function memberRow(unitId: string, userId: string, rowNo: number, isPrimary?: boolean) {
  return {
    rowNo,
    values: isPrimary === undefined ? {} : { isPrimary },
    target: target({ ...member(unitId, userId), unit: '', unitPath: '' }, `${unitId}:${userId}`),
  };
}

describe('OrgUnitTransferResource（docs/architecture/backend/22-data-transfer.md §12.3）', () => {
  it('登記部門與部門成員兩種資源，都屬於 organization feature', () => {
    const { registry, unitResource, memberResource } = setup();
    expect(registry.register).toHaveBeenCalledTimes(2);
    expect(unitResource.feature).toBe('organization');
    expect(memberResource.feature).toBe('organization');
  });

  describe('部門：匯出', () => {
    it('依組織樹深度優先排序，上層以代碼表示，沒有代碼時以路徑表示', async () => {
      const { unitExporter, unitResource } = setup();

      const pages = await collect(unitExporter.iterate({ kind: 'filter', filter: {} }, CTX));
      const rows = pages.flat() as OrgUnitExportRow[];

      expect(rows.map((row) => [row.id, row.path, row.parent])).toEqual([
        [HQ, '總部', null],
        [SALES, '總部 / 業務部', 'HQ'],
        [NORTH, '總部 / 業務部 / 北區', 'SALES'],
        [RD, '總部 / 研發部', 'HQ'],
        [ORPHAN, '北區', null],
      ]);
      const hq = rows[0];
      expect(
        Object.fromEntries(unitResource.columns.map((item) => [item.key, item.export?.get(hq)])),
      ).toEqual({
        id: HQ,
        code: 'HQ',
        name: '總部',
        parent: null,
        description: null,
        path: '總部',
        memberCount: 3,
      });
    });

    it('上層沒有代碼時，參照文字是上層的路徑', async () => {
      const { unitExporter } = setup([
        unit(HQ, { name: '總部' }),
        unit(SALES, { name: '業務部', parentId: HQ }),
      ]);
      const rows = (
        await collect(unitExporter.iterate({ kind: 'filter', filter: {} }, CTX))
      ).flat();
      expect((rows[1] as OrgUnitExportRow).parent).toBe('總部');
    });

    it('關鍵字篩選：只留 repository 比對到的部門，順序照組織樹', async () => {
      const { unitExporter, repo } = setup();
      repo.matchKeyword.mockResolvedValue([RD, SALES]);

      const rows = (
        await collect(unitExporter.iterate({ kind: 'filter', filter: { keyword: '部' } }, CTX))
      ).flat() as OrgUnitExportRow[];

      expect(repo.matchKeyword).toHaveBeenCalledWith('部');
      expect(rows.map((row) => row.id)).toEqual([SALES, RD]);
    });

    it('勾選範圍：只留指定的部門；count 是筆數', async () => {
      const { unitExporter, repo } = setup();
      expect(await unitExporter.count({ kind: 'ids', ids: [NORTH, HQ, uid(777)] }, CTX)).toBe(2);
      expect(repo.matchKeyword).not.toHaveBeenCalled();
    });

    it('超過一頁（500 筆）時分頁交出', async () => {
      const many = Array.from({ length: 501 }, (_, index) => unit(uid(10_000 + index)));
      const { unitExporter } = setup(many);
      const pages = await collect(unitExporter.iterate({ kind: 'filter', filter: {} }, CTX));
      expect(pages.map((page) => page.length)).toEqual([500, 1]);
    });

    it('上層互指（資料異常）時路徑不會無限迴圈', async () => {
      const a = uid(201);
      const b = uid(202);
      const { unitImporter } = setup([
        unit(a, { name: 'A', parentId: b }),
        unit(b, { name: 'B', parentId: a }),
      ]);
      const found = await unitImporter.resolveTargets?.('id', [a], CTX);
      expect(found?.get(a)?.[0]?.record).toMatchObject({ path: 'B / A' });
    });
  });

  describe('部門：上層參照與自動完成', () => {
    it.each([
      ['代碼（不分大小寫）', ' sales ', 'sales', { id: SALES, label: 'SALES' }],
      [
        '路徑（/ 前後有沒有空白都行）',
        '總部/業務部 / 北區',
        '總部/業務部 / 北區',
        { id: NORTH, label: '總部 / 業務部 / 北區' },
      ],
      ['id', RD.toUpperCase(), RD, { id: RD, label: '總部 / 研發部' }],
      ['唯一的名稱', '研發部', '研發部', { id: RD, label: '總部 / 研發部' }],
      ['同名多筆', '北區', '北區', 'ambiguous'],
    ])('以%s解析', async (_label, input, key, expected) => {
      const { unitResource } = setup();
      const resolved = await reference(unitResource, 'parent').resolve([input], CTX);
      expect(resolved).toEqual(new Map([[key, expected]]));
    });

    it('找不到（含對不上的路徑）時不出現在結果裡', async () => {
      const { unitResource } = setup();
      const resolved = await reference(unitResource, 'parent').resolve(
        ['總部/不存在', '沒有這個'],
        CTX,
      );
      expect(resolved.size).toBe(0);
    });

    it('上層與部門欄的搜尋：比對名稱或代碼，空白關鍵字列出全部', async () => {
      const { unitResource, memberResource } = setup();
      const search = reference(unitResource, 'parent').search;
      expect(await search('sal', CTX)).toEqual([{ id: SALES, label: 'SALES' }]);
      expect(await search('研發', CTX)).toEqual([{ id: RD, label: '總部 / 研發部' }]);
      expect(await search('  ', CTX)).toHaveLength(5);
      expect(await reference(memberResource, 'unit').search('hq', CTX)).toEqual([
        { id: HQ, label: 'HQ' },
      ]);
    });

    it('同一份檔案裡的上層以代碼欄引用', () => {
      const { unitResource } = setup();
      expect(reference(unitResource, 'parent').sameFile).toEqual({ column: 'code' });
    });

    it('代碼欄的自動完成只列出含關鍵字的代碼', async () => {
      const { unitResource } = setup();
      expect(await column(unitResource, 'code').import?.suggest?.('a', CTX)).toEqual(['SALES']);
      expect(await column(unitResource, 'code').import?.suggest?.('', CTX)).toEqual([
        'HQ',
        'SALES',
      ]);
    });
  });

  describe('部門：比對目標', () => {
    it('新增模式的唯一欄檢查交給 findTakenCodes', async () => {
      const { unitImporter, repo } = setup();
      expect(await unitImporter.findExisting?.('code', ['HQ'], CTX)).toEqual(new Set(['hq']));
      expect(repo.findTakenCodes).toHaveBeenCalledWith(['HQ']);
    });

    it('以 id 比對：只接受 UUID；以代碼比對：不分大小寫', async () => {
      const { unitImporter } = setup();

      const byId = await unitImporter.resolveTargets?.('id', [HQ.toUpperCase(), 'nope'], CTX);
      expect([...(byId?.keys() ?? [])]).toEqual([HQ]);
      expect(byId?.get(HQ)?.[0]).toMatchObject({ id: HQ, label: '總部', version: 1 });

      const byCode = await unitImporter.resolveTargets?.('code', ['Sales', 'NONE'], CTX);
      expect([...(byCode?.keys() ?? [])]).toEqual(['sales']);
      expect(byCode?.get('sales')?.[0]?.record).toMatchObject({ parent: 'HQ' });
    });

    it('手動指定目標：以 id 找，找不到的不出現', async () => {
      const { unitImporter } = setup();
      const found = await unitImporter.findTargetsById?.([SALES, uid(777)], CTX);
      expect([...(found?.keys() ?? [])]).toEqual([SALES]);
      expect(found?.get(SALES)?.label).toBe('業務部');
    });

    it('比對目標的下拉選單：名稱當標籤、路徑當說明', async () => {
      const { unitImporter } = setup();
      expect(await unitImporter.searchTargets?.('北區', CTX)).toEqual([
        { id: NORTH, label: '北區', description: '總部 / 業務部 / 北區' },
        { id: ORPHAN, label: '北區', description: '北區' },
      ]);
    });

    it('範本抽樣：依組織樹取前 limit 筆', async () => {
      const { unitImporter } = setup();
      const rows = (await unitImporter.sampleRecords?.(CTX, 2)) as OrgUnitExportRow[];
      expect(rows.map((row) => row.id)).toEqual([HQ, SALES]);
    });
  });

  describe('部門：套用', () => {
    it('新增：上層、代碼、說明有填才帶，交易後副作用轉成 resourceChanged', async () => {
      const { unitImporter, service } = setup();

      const result = await unitImporter.create?.(
        { name: '新部門', parent: HQ, code: 'NEW', description: '說明' },
        CTX,
        TX,
      );

      expect(service.createInTx).toHaveBeenCalledWith(
        { name: '新部門', parentId: HQ, code: 'NEW', description: '說明' },
        ACTOR,
        TX,
      );
      expect(result).toEqual({ id: uid(500), after: [EFFECT] });
    });

    it('新增：沒填上層、代碼、說明時都是 null', async () => {
      const { unitImporter, service } = setup();
      await unitImporter.create?.({ name: '新部門' }, CTX, TX);
      expect(service.createInTx).toHaveBeenCalledWith(
        { name: '新部門', parentId: null, code: null, description: null },
        ACTOR,
        TX,
      );
    });

    it('修改名稱與上層：先改內容，再以新版本號搬移', async () => {
      const { unitImporter, service } = setup();

      const result = await unitImporter.update?.(
        { id: SALES, version: 3 },
        { name: '業務一部', parent: RD },
        CTX,
        TX,
      );

      expect(service.updateInTx).toHaveBeenCalledWith(
        SALES,
        { name: '業務一部', version: 3 },
        ACTOR,
        TX,
      );
      expect(service.moveInTx).toHaveBeenCalledWith(SALES, { parentId: RD, version: 7 }, ACTOR, TX);
      expect(result).toEqual({ id: SALES, after: [EFFECT, EFFECT] });
    });

    it('只清空說明：說明送 null，不搬移', async () => {
      const { unitImporter, service } = setup();
      await unitImporter.update?.({ id: SALES, version: 3 }, { description: null }, CTX, TX);
      expect(service.updateInTx).toHaveBeenCalledWith(
        SALES,
        { description: null, version: 3 },
        ACTOR,
        TX,
      );
      expect(service.moveInTx).not.toHaveBeenCalled();
    });

    it('只改說明為文字', async () => {
      const { unitImporter, service } = setup();
      await unitImporter.update?.({ id: SALES, version: 3 }, { description: '新說明' }, CTX, TX);
      expect(service.updateInTx).toHaveBeenCalledWith(
        SALES,
        { description: '新說明', version: 3 },
        ACTOR,
        TX,
      );
    });

    it('上層填 \\N（null）：只搬到最上層，帶原本的版本號', async () => {
      const { unitImporter, service } = setup();
      const result = await unitImporter.update?.(
        { id: SALES, version: 3 },
        { parent: null },
        CTX,
        TX,
      );
      expect(service.updateInTx).not.toHaveBeenCalled();
      expect(service.moveInTx).toHaveBeenCalledWith(
        SALES,
        { parentId: null, version: 3 },
        ACTOR,
        TX,
      );
      expect(result?.after).toEqual([EFFECT]);
    });
  });

  describe('部門：validateRows（同層撞名與循環）', () => {
    it('新增：同一個上層之下已有同名（不分大小寫）→ alreadyExists', async () => {
      const { unitImporter } = setup();
      const issues = await unitImporter.validateRows?.(
        'create',
        [
          { rowNo: 2, values: { name: '業務部', parent: HQ } },
          { rowNo: 3, values: { name: '業務部', parent: RD } },
          { rowNo: 4, values: { name: '總部' } },
          { rowNo: 5, values: { name: '總部', parent: null } },
        ],
        CTX,
      );
      expect(issues).toEqual(
        new Map([
          [2, alreadyExists('業務部')],
          [4, alreadyExists('總部')],
          [5, alreadyExists('總部')],
        ]),
      );
    });

    it('新增：上層是同一份檔案的列（佔位值）或沒填名稱時不檢查', async () => {
      const { unitImporter } = setup();
      const issues = await unitImporter.validateRows?.(
        'create',
        [
          { rowNo: 2, values: { name: '總部', parent: { sameFileRow: 3 } } },
          { rowNo: 3, values: { parent: HQ } },
        ],
        CTX,
      );
      expect(issues?.size).toBe(0);
    });

    it('修改：搬到自己或自己的下層之下 → referenceCycle', async () => {
      const { unitImporter } = setup();
      const sales = await exportRow(SALES);
      const issues = await unitImporter.validateRows?.(
        'update',
        [
          {
            rowNo: 2,
            values: { parent: NORTH },
            target: target(sales, SALES),
            changed: ['parent'],
          },
          {
            rowNo: 3,
            values: { parent: SALES },
            target: target(sales, SALES),
            changed: ['parent'],
          },
        ],
        CTX,
      );
      expect(issues).toEqual(
        new Map([
          [
            2,
            [
              {
                column: 'parent',
                code: 'referenceCycle',
                params: { value: '總部 / 業務部 / 北區' },
                severity: 'error',
              },
            ],
          ],
          [
            3,
            [
              {
                column: 'parent',
                code: 'referenceCycle',
                params: { value: 'SALES' },
                severity: 'error',
              },
            ],
          ],
        ]),
      );
    });

    it('修改：搬到其他上層時，以新上層之下的部門檢查撞名（沒填名稱時用目標的名稱）', async () => {
      const { unitImporter } = setup();
      const north = await exportRow(NORTH);
      const issues = await unitImporter.validateRows?.(
        'update',
        [
          {
            rowNo: 2,
            values: { name: '總部', parent: null },
            target: target(north, NORTH),
            changed: ['name', 'parent'],
          },
          {
            rowNo: 3,
            values: { parent: HQ },
            target: target(north, NORTH),
            changed: ['parent'],
          },
        ],
        CTX,
      );
      expect(issues).toEqual(
        new Map([
          [
            2,
            [
              {
                column: 'name',
                code: 'alreadyExists',
                params: { value: '總部' },
                severity: 'error',
              },
            ],
          ],
        ]),
      );
    });

    it('修改：只改名稱時以目標原本的上層檢查，同名的是自己不算', async () => {
      const { unitImporter } = setup();
      const sales = await exportRow(SALES);
      const issues = await unitImporter.validateRows?.(
        'update',
        [
          { rowNo: 2, values: { name: '研發部' }, target: target(sales, SALES), changed: ['name'] },
          { rowNo: 3, values: { name: '業務部' }, target: target(sales, SALES), changed: ['name'] },
        ],
        CTX,
      );
      expect(issues).toEqual(
        new Map([
          [
            2,
            [
              {
                column: 'name',
                code: 'alreadyExists',
                params: { value: '研發部' },
                severity: 'error',
              },
            ],
          ],
        ]),
      );
    });

    it('修改：名稱與上層都沒變時不檢查；沒有目標時也不檢查', async () => {
      const { unitImporter } = setup();
      const sales = await exportRow(SALES);
      const issues = await unitImporter.validateRows?.(
        'update',
        [
          {
            rowNo: 2,
            values: { name: '研發部', description: 'x' },
            target: target(sales, SALES),
            changed: ['description'],
          },
          { rowNo: 3, values: { description: 'x' } },
          { rowNo: 4, values: { name: '研發部' }, target: target(sales, SALES) },
        ],
        CTX,
      );
      expect(issues?.size).toBe(0);
    });

    it('修改：最上層的部門改名時，以最上層的部門檢查撞名', async () => {
      const { unitImporter } = setup();
      const rd = { ...(await exportRow(RD)), parentId: null };
      const issues = await unitImporter.validateRows?.(
        'update',
        [{ rowNo: 2, values: { name: '總部' }, target: target(rd, RD), changed: ['name'] }],
        CTX,
      );
      expect(issues?.get(2)?.[0]?.code).toBe('alreadyExists');
    });
  });

  describe('部門成員：匯出', () => {
    const members = [
      member(NORTH, ALICE, { isManager: true, title: '經理' }),
      member(HQ, BOB, { isPrimary: true }),
      member(SALES, ALICE),
      member(ORPHAN, BOB),
    ];

    it('依組織樹的順序輸出，帶部門的參照文字與路徑', async () => {
      const { memberExporter, memberResource } = setup(sampleTree(), members);

      const rows = (
        await collect(memberExporter.iterate({ kind: 'filter', filter: {} }, CTX))
      ).flat() as OrgUnitMemberExportRow[];

      expect(rows.map((row) => [row.unitId, row.unit, row.unitPath])).toEqual([
        [HQ, 'HQ', '總部'],
        [SALES, 'SALES', '總部 / 業務部'],
        [NORTH, '總部 / 業務部 / 北區', '總部 / 業務部 / 北區'],
        [ORPHAN, '北區', '北區'],
      ]);
      const north = rows[2];
      expect(
        Object.fromEntries(
          memberResource.columns.map((item) => [item.key, item.export?.get(north)]),
        ),
      ).toEqual({
        id: `${NORTH}:${ALICE}`,
        unit: '總部 / 業務部 / 北區',
        user: north?.email,
        isManager: true,
        isPrimary: false,
        title: '經理',
        displayName: north?.displayName,
        unitPath: '總部 / 業務部 / 北區',
      });
    });

    it('指定部門：預設只有那個部門，includeDescendants 時含下層', async () => {
      const { memberExporter } = setup(sampleTree(), members);
      expect(await memberExporter.count({ kind: 'filter', filter: { unitId: SALES } }, CTX)).toBe(
        1,
      );
      expect(
        await memberExporter.count(
          { kind: 'filter', filter: { unitId: SALES, includeDescendants: true } },
          CTX,
        ),
      ).toBe(2);
      expect(
        await memberExporter.count(
          { kind: 'filter', filter: { unitId: uid(777), includeDescendants: true } },
          CTX,
        ),
      ).toBe(0);
    });

    it('勾選範圍：只讀指定部門的成員', async () => {
      const { memberExporter, repo } = setup(sampleTree(), members);
      expect(await memberExporter.count({ kind: 'ids', ids: [HQ, ORPHAN] }, CTX)).toBe(2);
      expect(repo.membersOfUnits).toHaveBeenCalledWith([HQ, ORPHAN]);
    });

    it.each([
      [{ includeDescendants: 'true' }, { includeDescendants: true }],
      [{ includeDescendants: 'false' }, { includeDescendants: false }],
      [{}, {}],
    ])('篩選條件的 includeDescendants 由字串轉成布林：%o', (input, expected) => {
      const { memberExporter } = setup();
      expect(memberExporter.filterSchema.parse(input)).toEqual(expected);
    });

    it('每 200 個部門查一次，成員湊滿 500 筆交出一頁', async () => {
      const units = Array.from({ length: 250 }, (_, index) => unit(uid(20_000 + index)));
      const many = units.flatMap((item, index) => [
        member(item.id, uid(30_000 + index * 3)),
        member(item.id, uid(30_000 + index * 3 + 1)),
        member(item.id, uid(30_000 + index * 3 + 2)),
      ]);
      const { memberExporter, repo } = setup(units, many);

      const pages = await collect(memberExporter.iterate({ kind: 'filter', filter: {} }, CTX));

      expect(repo.membersOfUnits.mock.calls.map(([ids]) => ids.length)).toEqual([200, 50]);
      expect(pages.map((page) => page.length)).toEqual([500, 250]);
      expect(pages[0]?.[0]?.unitId).toBe(units[0]?.id);
    });

    it('範本抽樣：湊到 limit 筆就停止讀取', async () => {
      const units = Array.from({ length: 250 }, (_, index) => unit(uid(20_000 + index)));
      const many = units.flatMap((item, index) => [
        member(item.id, uid(30_000 + index * 3)),
        member(item.id, uid(30_000 + index * 3 + 1)),
        member(item.id, uid(30_000 + index * 3 + 2)),
      ]);
      const { memberImporter, repo } = setup(units, many);

      const rows = await memberImporter.sampleRecords?.(CTX, 3);

      expect(rows).toHaveLength(3);
      expect(repo.membersOfUnits).toHaveBeenCalledTimes(1);
    });

    it('範本抽樣：成員不足 limit 時全部回傳', async () => {
      const { memberImporter } = setup(sampleTree(), members);
      expect(await memberImporter.sampleRecords?.(CTX, 10)).toHaveLength(4);
    });
  });

  describe('部門成員：參照與比對目標', () => {
    it('使用者欄：以 Email（不分大小寫）或 id 解析，找不到的不出現', async () => {
      const { memberResource, repo } = setup();
      repo.findActiveUsersByEmails.mockResolvedValue([
        { id: ALICE, email: 'Alice@Example.com' },
        { id: BOB, email: 'bob@example.com' },
      ]);

      const resolved = await reference(memberResource, 'user').resolve(
        [' alice@example.com ', BOB, 'nobody@example.com'],
        CTX,
      );

      expect(resolved).toEqual(
        new Map([
          ['alice@example.com', { id: ALICE, label: 'Alice@Example.com' }],
          [BOB, { id: BOB, label: 'bob@example.com' }],
        ]),
      );
    });

    it('使用者欄的搜尋：以 Email 當標籤', async () => {
      const { memberResource, repo } = setup();
      expect(await reference(memberResource, 'user').search('ali', CTX)).toEqual([
        { id: ALICE, label: 'alice@example.com' },
      ]);
      expect(repo.searchActiveUsers).toHaveBeenCalledWith('ali', 20);
    });

    it('部門欄：與上層欄相同的解析方式', async () => {
      const { memberResource } = setup();
      expect(await reference(memberResource, 'unit').resolve(['hq'], CTX)).toEqual(
        new Map([['hq', { id: HQ, label: 'HQ' }]]),
      );
    });

    it('比對目標：格式不對的 ID 不查詢', async () => {
      const { memberImporter, repo } = setup();
      expect((await memberImporter.resolveTargets?.('id', ['x', HQ], CTX))?.size).toBe(0);
      expect(repo.findMemberships).not.toHaveBeenCalled();
    });

    it('比對目標：以「部門 id:使用者 id」查成員資格，標籤是部門與 Email', async () => {
      const { memberImporter, repo } = setup();
      const row = member(SALES, ALICE, { email: 'alice@example.com' });
      repo.findMemberships.mockResolvedValue(new Map([[`${SALES}:${ALICE}`, row]]));
      const key = `${SALES}:${ALICE}`.toUpperCase();

      const found = await memberImporter.findTargetsById?.([key, `${HQ}:${BOB}`], CTX);

      expect(repo.findMemberships).toHaveBeenCalledWith([
        { unitId: SALES, userId: ALICE },
        { unitId: HQ, userId: BOB },
      ]);
      expect(found).toEqual(
        new Map([
          [
            `${SALES}:${ALICE}`,
            {
              id: `${SALES}:${ALICE}`,
              label: 'SALES · alice@example.com',
              version: 1,
              record: { ...row, unit: 'SALES', unitPath: '總部 / 業務部' },
            },
          ],
        ]),
      );
    });
  });

  describe('部門成員：套用', () => {
    it('新增：主管、主要部門、職稱有填才帶；結果的 id 是使用者', async () => {
      const { memberImporter, service } = setup();

      const result = await memberImporter.create?.(
        { unit: SALES, user: ALICE, isManager: true, isPrimary: false, title: '經理' },
        CTX,
        TX,
      );

      expect(service.updateMembersInTx).toHaveBeenCalledWith(
        SALES,
        {
          add: [{ userId: ALICE, isManager: true, isPrimary: false, title: '經理' }],
          update: [],
          remove: [],
        },
        ACTOR,
        TX,
      );
      expect(result).toEqual({ id: ALICE, after: [EFFECT] });
    });

    it('新增：沒填的欄位不帶', async () => {
      const { memberImporter, service } = setup();
      await memberImporter.create?.({ unit: SALES, user: ALICE }, CTX, TX);
      expect(service.updateMembersInTx).toHaveBeenCalledWith(
        SALES,
        { add: [{ userId: ALICE }], update: [], remove: [] },
        ACTOR,
        TX,
      );
    });

    it('修改：從目標 id 拆出部門與使用者，只帶有變更的欄位；職稱 \\N 清空', async () => {
      const { memberImporter, service } = setup();

      const result = await memberImporter.update?.(
        { id: `${SALES}:${ALICE}`, version: 1 },
        { isManager: 1, isPrimary: 0, title: null },
        CTX,
        TX,
      );

      expect(service.updateMembersInTx).toHaveBeenCalledWith(
        SALES,
        {
          add: [],
          update: [{ userId: ALICE, isManager: true, isPrimary: false, title: null }],
          remove: [],
        },
        ACTOR,
        TX,
      );
      expect(result).toEqual({ id: ALICE, after: [EFFECT] });
    });

    it('修改：沒有變更的欄位時只帶使用者；職稱有填時照填', async () => {
      const { memberImporter, service } = setup();
      await memberImporter.update?.({ id: `${SALES}:${ALICE}`, version: 1 }, {}, CTX, TX);
      await memberImporter.update?.(
        { id: `${SALES}:${ALICE}`, version: 1 },
        { title: '組長' },
        CTX,
        TX,
      );
      expect(service.updateMembersInTx.mock.calls.map((call) => call[1])).toEqual([
        { add: [], update: [{ userId: ALICE }], remove: [] },
        { add: [], update: [{ userId: ALICE, title: '組長' }], remove: [] },
      ]);
    });

    it('修改：目標 id 沒有冒號時以空字串當使用者', async () => {
      const { memberImporter, service } = setup();
      const result = await memberImporter.update?.({ id: SALES, version: 1 }, {}, CTX, TX);
      expect(service.updateMembersInTx).toHaveBeenCalledWith(
        SALES,
        { add: [], update: [{ userId: '' }], remove: [] },
        ACTOR,
        TX,
      );
      expect(result?.id).toBe('');
    });
  });

  describe('部門成員：validateRows（D6 不能改自己、已是成員、主要部門衝突）', () => {
    it('新增：改自己 → user 欄 selfModify；已是成員 → alreadyExists', async () => {
      const { memberImporter, repo } = setup();
      repo.findMemberships.mockResolvedValue(new Map([[`${SALES}:${BOB}`, member(SALES, BOB)]]));

      const issues = await memberImporter.validateRows?.(
        'create',
        [
          createRow(2, { unit: SALES, user: ACTOR_ID }),
          createRow(3, { unit: SALES, user: BOB }),
          createRow(4, { unit: RD, user: BOB }),
          createRow(5, { unit: { sameFile: 1 }, user: ALICE }),
          createRow(6, { unit: RD }),
        ],
        CTX,
      );

      expect(repo.findMemberships).toHaveBeenCalledWith([
        { unitId: SALES, userId: ACTOR_ID },
        { unitId: SALES, userId: BOB },
        { unitId: RD, userId: BOB },
      ]);
      expect(issues).toEqual(
        new Map([
          [2, [{ column: 'user', code: 'selfModify', severity: 'error' }]],
          [
            3,
            [{ column: 'user', code: 'alreadyExists', params: { value: BOB }, severity: 'error' }],
          ],
        ]),
      );
    });

    it('新增：同一個人在同一批有兩個主要部門 → 兩列都標 primaryConflict', async () => {
      const { memberImporter } = setup();
      const issues = await memberImporter.validateRows?.(
        'create',
        [
          createRow(2, { unit: SALES, user: ALICE, isPrimary: true }),
          createRow(3, { unit: RD, user: ALICE, isPrimary: true }),
          createRow(4, { unit: HQ, user: BOB, isPrimary: true }),
          createRow(5, { unit: HQ, user: ALICE, isPrimary: false }),
        ],
        CTX,
      );
      const conflict = [
        {
          column: 'isPrimary',
          code: 'primaryConflict',
          params: { rows: [2, 3] },
          severity: 'error',
        },
      ];
      expect(issues).toEqual(
        new Map([
          [2, conflict],
          [3, conflict],
        ]),
      );
    });

    it('修改：部門與使用者取自目標，不查既有成員；改自己 → selfModify 不指向欄位', async () => {
      const { memberImporter, repo } = setup();

      const issues = await memberImporter.validateRows?.(
        'update',
        [
          memberRow(SALES, ACTOR_ID, 2),
          memberRow(SALES, ALICE, 3, true),
          memberRow(RD, ALICE, 4, true),
          { rowNo: 5, values: { isPrimary: true } },
        ],
        CTX,
      );

      expect(repo.findMemberships).not.toHaveBeenCalled();
      expect(issues?.get(2)).toEqual([{ column: null, code: 'selfModify', severity: 'error' }]);
      expect(issues?.get(3)?.[0]).toMatchObject({
        code: 'primaryConflict',
        params: { rows: [3, 4] },
      });
      expect(issues?.has(5)).toBe(false);
    });
  });
});
