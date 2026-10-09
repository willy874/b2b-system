import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import { DataTransferRegistry } from '@/modules/data-transfer/data-transfer-registry.service';
import { DATA_TRANSFER_EXPORT_PAGE_SIZE } from '@/modules/data-transfer/data-transfer.constants';
import { defineTransferResource } from '@/modules/data-transfer/data-transfer.definition';
import type {
  AfterCommitEffect,
  ExportScope,
  MatchResult,
  ResolvedReference,
  ResolvedRow,
  RowIssue,
  TransferColumn,
  TransferContext,
} from '@/modules/data-transfer/data-transfer.types';

import { CreateOrgUnitSchema } from './dto/org-unit.dto';
import type { OrgUnitMembershipRow, OrgUnitWithCounts } from './org-unit.repository';
import { OrgUnitRepository } from './org-unit.repository';
import { OrgUnitService } from './org-unit.service';
import type { OrgUnitAfterCommit } from './org-unit.service';

/** 路徑的分隔：匯出寫 ` / `，匯入接受 `/` 前後有沒有空白。 */
const PATH_SEPARATOR = ' / ';
const UUID = z.string().uuid();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 部門成員的 ID：`部門 id:使用者 id`（成員關係沒有自己的 id）。 */
const MEMBERSHIP_ID_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SUGGEST_LIMIT = 20;
const ReferenceText = z.string().trim().min(1).max(500);
const TitleSchema = z.string().trim().max(64);

const OrgUnitExportFilterSchema = z.object({ keyword: z.string().trim().max(100).optional() });
type OrgUnitExportFilter = z.infer<typeof OrgUnitExportFilterSchema>;

const OrgUnitMemberExportFilterSchema = z.object({
  unitId: z.string().uuid().optional(),
  includeDescendants: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
type OrgUnitMemberExportFilter = z.infer<typeof OrgUnitMemberExportFilterSchema>;

/** 匯入匯出的一筆部門：上層以代碼（沒有時以路徑）表示，搬到另一個租戶也對得上。 */
export interface OrgUnitExportRow extends OrgUnitWithCounts {
  /** 自己的完整路徑（最上層在前）。 */
  path: string;
  /** 上層的參照文字（代碼，沒有代碼時是路徑）；最上層是 null。 */
  parent: string | null;
}

/** 匯入匯出的一筆部門成員：加上部門的參照文字。 */
export interface OrgUnitMemberExportRow extends OrgUnitMembershipRow {
  unit: string;
  unitPath: string;
}

/**
 * 整棵部門樹（未刪除）的記憶體索引：路徑、參照文字、深度優先的順序、名稱與路徑的解析。
 * 部門數量級是數百到數千，每次驗證、匯出讀一次整棵樹比逐筆查詢簡單，也與組織圖的讀法一致（23-organization.md §2）。
 */
class OrgTree {
  readonly byId: Map<string, OrgUnitWithCounts>;
  private readonly children = new Map<string | null, OrgUnitWithCounts[]>();
  private readonly paths = new Map<string, string[]>();

  constructor(units: readonly OrgUnitWithCounts[]) {
    this.byId = new Map(units.map((unit) => [unit.id, unit]));
    for (const unit of units) {
      // 上層不在清單裡時當成最上層，樹才接得起來。只是防呆：結構的寫入在鎖之下檢查上層與下層，
      // 上層已刪除的部門不會存在（docs/architecture/backend/23-organization.md §2）
      const parent = unit.parentId && this.byId.has(unit.parentId) ? unit.parentId : null;
      this.children.set(parent, [...(this.children.get(parent) ?? []), unit]);
    }
  }

  /** 最上層在前的名稱路徑（含自己）。 */
  pathOf(id: string): string[] {
    const cached = this.paths.get(id);
    if (cached) return cached;
    const names: string[] = [];
    const seen = new Set<string>();
    let current = this.byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    this.paths.set(id, names);
    return names;
  }

  /** 參照文字：代碼，沒有代碼時是路徑。 */
  labelOf(id: string): string {
    const unit = this.byId.get(id);
    return unit?.code ?? this.pathOf(id).join(PATH_SEPARATOR);
  }

  /** 深度優先（上層在下層之前；同層依排序）：匯出的檔案直接匯回時，上層一定在前面。 */
  ordered(): OrgUnitWithCounts[] {
    const result: OrgUnitWithCounts[] = [];
    const visit = (parent: string | null) => {
      for (const unit of this.children.get(parent) ?? []) {
        result.push(unit);
        visit(unit.id);
      }
    };
    visit(null);
    return result;
  }

  /** 自己與所有下層的 id。 */
  subtree(id: string): string[] {
    const result: string[] = [];
    const visit = (current: string) => {
      result.push(current);
      for (const child of this.children.get(current) ?? []) visit(child.id);
    };
    if (this.byId.has(id)) visit(id);
    return result;
  }

  toExportRow(unit: OrgUnitWithCounts): OrgUnitExportRow {
    return {
      ...unit,
      path: this.pathOf(unit.id).join(PATH_SEPARATOR),
      parent: unit.parentId && this.byId.has(unit.parentId) ? this.labelOf(unit.parentId) : null,
    };
  }

  /**
   * 部門的參照（不分大小寫）：代碼 → 路徑（`總部/業務部`）→ id → 名稱（只有一個部門叫這個名字時）。
   * 回傳的 key 是正規化（trim、小寫）後的輸入。
   */
  resolve(names: readonly string[]): Map<string, ResolvedReference> {
    const result = new Map<string, ResolvedReference>();
    const units = [...this.byId.values()];
    for (const name of names) {
      const key = name.trim().toLowerCase();
      const byCode = units.find((unit) => unit.code?.toLowerCase() === key);
      if (byCode) {
        result.set(key, { id: byCode.id, label: this.labelOf(byCode.id) });
        continue;
      }
      const segments = key
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (segments.length > 1) {
        const byPath = units.find((unit) => {
          const path = this.pathOf(unit.id).map((part) => part.toLowerCase());
          return path.length === segments.length && path.every((part, i) => part === segments[i]);
        });
        if (byPath) {
          result.set(key, { id: byPath.id, label: this.labelOf(byPath.id) });
          continue;
        }
      }
      const byId = this.byId.get(key);
      if (byId) {
        result.set(key, { id: byId.id, label: this.labelOf(byId.id) });
        continue;
      }
      const byName = units.filter((unit) => unit.name.toLowerCase() === key);
      if (byName.length === 1 && byName[0]) {
        result.set(key, { id: byName[0].id, label: this.labelOf(byName[0].id) });
      } else if (byName.length > 1) {
        result.set(key, 'ambiguous');
      }
    }
    return result;
  }

  /** 含關鍵字的代碼（代碼欄的自動完成）。 */
  codes(keyword: string, limit: number): string[] {
    const wanted = keyword.trim().toLowerCase();
    return this.ordered()
      .flatMap((unit) => (unit.code && unit.code.toLowerCase().includes(wanted) ? [unit.code] : []))
      .slice(0, limit);
  }

  search(keyword: string, limit: number): Array<{ id: string; label: string }> {
    const wanted = keyword.trim().toLowerCase();
    return this.ordered()
      .filter(
        (unit) =>
          !wanted ||
          unit.name.toLowerCase().includes(wanted) ||
          unit.code?.toLowerCase().includes(wanted),
      )
      .slice(0, limit)
      .map((unit) => ({ id: unit.id, label: this.labelOf(unit.id) }));
  }
}

/**
 * 組織的匯入匯出（docs/architecture/backend/22-data-transfer.md §12.3、23-organization.md）。兩種資源：
 * - `orgUnit`：部門樹。上層以代碼或路徑引用，也可以引用 **同一份檔案** 裡要新增的部門（§7.8）。
 * - `orgUnitMember`：一列一筆成員資格（部門 × 使用者），可以新增與修改主管、主要部門、職稱；移除成員在畫面上做。
 * 套用走 `OrgUnitService` 的交易內版本：層數、循環、同層撞名、不能改自己（D6）都只寫一次。
 */
@Injectable()
export class OrgUnitTransferResource implements OnModuleInit {
  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly repo: OrgUnitRepository,
    private readonly units: OrgUnitService,
  ) {}

  onModuleInit(): void {
    this.registerUnits();
    this.registerMembers();
  }

  private async tree(): Promise<OrgTree> {
    return new OrgTree(await this.repo.listAll());
  }

  private registerUnits(): void {
    const columns: TransferColumn<OrgUnitExportRow>[] = [
      {
        key: 'id',
        label: { 'zh-TW': 'ID', 'en-US': 'ID' },
        kind: 'string',
        hint: {
          'zh-TW': '修改模式的比對鍵：有填就只用它比對，找不到不會改用代碼。',
          'en-US': 'Match key in update mode: when filled, only the ID is used to find the unit.',
        },
        export: { get: (unit) => unit.id },
        import: { modes: ['update'], matchKey: 1, schema: UUID },
      },
      {
        key: 'code',
        label: { 'zh-TW': '代碼', 'en-US': 'Code' },
        kind: 'string',
        example: 'SALES',
        hint: {
          'zh-TW':
            '英數與 . _ -，不可重複；其他列的「上層」可以填它。修改模式沒有 ID 時以它比對（不能修改）。',
          'en-US':
            'Letters, digits, . _ -; unique. Other rows can use it as Parent. Used to find the unit in update mode when ID is empty (cannot be changed).',
        },
        export: { get: (unit) => unit.code },
        import: {
          modes: ['create', 'update'],
          matchKey: 2,
          schema: CreateOrgUnitSchema.shape.code.unwrap().unwrap(),
          suggest: async (keyword) => (await this.tree()).codes(keyword, SUGGEST_LIMIT),
        },
      },
      {
        key: 'name',
        label: { 'zh-TW': '名稱', 'en-US': 'Name' },
        aliases: ['unit', 'department', '部門', '部門名稱'],
        kind: 'string',
        example: 'Sales',
        hint: {
          'zh-TW': '同一個上層之下不可重複。',
          'en-US': 'Unique under the same parent.',
        },
        export: { get: (unit) => unit.name },
        import: {
          modes: ['create', 'update'],
          requiredOnCreate: true,
          schema: CreateOrgUnitSchema.shape.name,
        },
      },
      {
        key: 'parent',
        label: { 'zh-TW': '上層', 'en-US': 'Parent' },
        aliases: ['parent code', 'parent unit', '上層部門', '上層代碼'],
        kind: 'reference',
        example: 'HQ',
        hint: {
          'zh-TW':
            '上層的代碼或路徑（例：總部/業務部），也可以是檔案裡另一列的代碼；空白是最上層。修改模式改了就搬到新上層的最後，\\N 搬到最上層。',
          'en-US':
            'Code or path (e.g. HQ/Sales) of the parent, or the code of another row in this file; empty means top level. Changing it in update mode moves the unit to the end of the new parent; \\N moves it to the top level.',
        },
        reference: {
          resolve: async (names) => (await this.tree()).resolve(names),
          search: async (keyword) => (await this.tree()).search(keyword, SUGGEST_LIMIT),
          sameFile: { column: 'code' },
        },
        export: { get: (unit) => unit.parent },
        import: { modes: ['create', 'update'], nullable: true, schema: ReferenceText },
      },
      {
        key: 'description',
        label: { 'zh-TW': '說明', 'en-US': 'Description' },
        kind: 'string',
        export: { get: (unit) => unit.description },
        import: {
          modes: ['create', 'update'],
          nullable: true,
          schema: CreateOrgUnitSchema.shape.description.unwrap().unwrap(),
        },
      },
      {
        key: 'path',
        label: { 'zh-TW': '路徑', 'en-US': 'Path' },
        kind: 'string',
        export: { get: (unit) => unit.path },
      },
      {
        key: 'memberCount',
        label: { 'zh-TW': '成員數', 'en-US': 'Members' },
        kind: 'number',
        export: { get: (unit) => unit.memberCount },
      },
    ];

    this.registry.register(
      defineTransferResource<OrgUnitExportFilter, OrgUnitExportRow>({
        type: 'orgUnit',
        feature: 'organization',
        fileBaseName: 'org-units',
        label: { 'zh-TW': '部門', 'en-US': 'Org units' },
        columns,
        exporter: {
          permissions: [PERMISSION.ORG_UNIT_EXPORT],
          filterSchema: OrgUnitExportFilterSchema,
          idSchema: UUID,
          orderHint: {
            'zh-TW': '依組織樹排序（上層在前）',
            'en-US': 'In tree order (parents first)',
          },
          iterate: (scope) => this.iterateUnits(scope),
          count: async (scope) => (await this.unitsInScope(scope)).length,
        },
        importer: {
          modes: {
            create: { permissions: [PERMISSION.ORG_UNIT_CREATE] },
            update: { permissions: [PERMISSION.ORG_UNIT_UPDATE] },
          },
          uniqueColumns: ['code'],
          findExisting: (_column, values) => this.repo.findTakenCodes(values),
          resolveTargets: (column, values) => this.resolveUnitTargets(column, values),
          findTargetsById: async (ids) => {
            const found = await this.resolveUnitTargets('id', ids);
            return new Map(
              [...found].flatMap(([id, matches]) => (matches[0] ? [[id, matches[0]]] : [])),
            );
          },
          searchTargets: async (keyword) => {
            const tree = await this.tree();
            return tree.search(keyword, SUGGEST_LIMIT).map((option) => ({
              id: option.id,
              label: tree.byId.get(option.id)?.name ?? option.label,
              description: tree.pathOf(option.id).join(PATH_SEPARATOR),
            }));
          },
          validateRows: (mode, rows) => this.validateUnitRows(mode, rows),
          sampleRecords: async (_ctx, limit) => {
            const tree = await this.tree();
            return tree
              .ordered()
              .slice(0, limit)
              .map((unit) => tree.toExportRow(unit));
          },
          create: async (values, ctx, tx) => {
            const { unit, after } = await this.units.createInTx(
              {
                name: String(values.name),
                parentId: typeof values.parent === 'string' ? values.parent : null,
                code: typeof values.code === 'string' ? values.code : null,
                description: typeof values.description === 'string' ? values.description : null,
              },
              ctx.actor,
              tx,
            );
            return { id: unit.id, after: toEffects(after) };
          },
          update: async (target, patch, ctx, tx) => {
            const effects: AfterCommitEffect[] = [];
            let version = target.version;
            if ('name' in patch || 'description' in patch) {
              const { unit, after } = await this.units.updateInTx(
                target.id,
                {
                  ...('name' in patch ? { name: String(patch.name) } : {}),
                  ...('description' in patch
                    ? { description: (patch.description as string | null) ?? null }
                    : {}),
                  version,
                },
                ctx.actor,
                tx,
              );
              version = unit.version;
              effects.push(...toEffects(after));
            }
            if ('parent' in patch) {
              const { after } = await this.units.moveInTx(
                target.id,
                { parentId: typeof patch.parent === 'string' ? patch.parent : null, version },
                ctx.actor,
                tx,
              );
              effects.push(...toEffects(after));
            }
            return { id: target.id, after: effects };
          },
        },
      }),
    );
  }

  private registerMembers(): void {
    const columns: TransferColumn<OrgUnitMemberExportRow>[] = [
      {
        key: 'id',
        label: { 'zh-TW': 'ID', 'en-US': 'ID' },
        kind: 'string',
        hint: {
          'zh-TW': '修改模式的比對鍵（匯出檔裡的值，`部門 ID:使用者 ID`）；新增時不填。',
          'en-US':
            'Match key in update mode (as exported: `unit ID:user ID`); leave empty when adding.',
        },
        export: { get: (row) => `${row.unitId}:${row.userId}` },
        import: { modes: ['update'], matchKey: 1, schema: z.string().regex(MEMBERSHIP_ID_PATTERN) },
      },
      {
        key: 'unit',
        label: { 'zh-TW': '部門', 'en-US': 'Unit' },
        aliases: ['department', 'unit code', '部門代碼'],
        kind: 'reference',
        example: 'SALES',
        hint: {
          'zh-TW': '部門的代碼或路徑（例：總部/業務部）。',
          'en-US': 'Code or path of the unit (e.g. HQ/Sales).',
        },
        reference: {
          resolve: async (names) => (await this.tree()).resolve(names),
          search: async (keyword) => (await this.tree()).search(keyword, SUGGEST_LIMIT),
        },
        export: { get: (row) => row.unit },
        import: { modes: ['create'], requiredOnCreate: true, schema: ReferenceText },
      },
      {
        key: 'user',
        label: { 'zh-TW': '使用者', 'en-US': 'User' },
        aliases: ['email', 'user email', '成員', 'Email'],
        kind: 'reference',
        example: 'alice@example.com',
        hint: { 'zh-TW': '使用者的 Email。', 'en-US': 'Email of the user.' },
        reference: {
          resolve: (values) => this.resolveUsers(values),
          search: async (keyword) =>
            (await this.repo.searchActiveUsers(keyword, SUGGEST_LIMIT)).map((user) => ({
              id: user.id,
              label: user.email,
            })),
        },
        export: { get: (row) => row.email },
        import: { modes: ['create'], requiredOnCreate: true, schema: ReferenceText },
      },
      {
        key: 'isManager',
        label: { 'zh-TW': '主管', 'en-US': 'Manager' },
        kind: 'boolean',
        example: '否',
        hint: {
          'zh-TW': '是這個部門的主管（審批的「主管」規則找的人）。',
          'en-US': 'Manager of this unit (used by approval manager rules).',
        },
        export: { get: (row) => row.isManager },
        import: { modes: ['create', 'update'], schema: z.boolean() },
      },
      {
        key: 'isPrimary',
        label: { 'zh-TW': '主要部門', 'en-US': 'Primary unit' },
        kind: 'boolean',
        example: '是',
        hint: {
          'zh-TW': '一個人最多一個主要部門：設為是時，原本的主要部門會取消。',
          'en-US': 'A user has at most one primary unit: setting it clears the previous one.',
        },
        export: { get: (row) => row.isPrimary },
        import: { modes: ['create', 'update'], schema: z.boolean() },
      },
      {
        key: 'title',
        label: { 'zh-TW': '職稱', 'en-US': 'Title' },
        kind: 'string',
        export: { get: (row) => row.title },
        import: { modes: ['create', 'update'], nullable: true, schema: TitleSchema },
      },
      {
        key: 'displayName',
        label: { 'zh-TW': '顯示名稱', 'en-US': 'Display name' },
        kind: 'string',
        export: { get: (row) => row.displayName },
      },
      {
        key: 'unitPath',
        label: { 'zh-TW': '部門路徑', 'en-US': 'Unit path' },
        kind: 'string',
        export: { get: (row) => row.unitPath },
      },
    ];

    this.registry.register(
      defineTransferResource<OrgUnitMemberExportFilter, OrgUnitMemberExportRow>({
        type: 'orgUnitMember',
        feature: 'organization',
        fileBaseName: 'org-unit-members',
        label: { 'zh-TW': '部門成員', 'en-US': 'Org unit members' },
        columns,
        exporter: {
          permissions: [PERMISSION.ORG_UNIT_EXPORT],
          filterSchema: OrgUnitMemberExportFilterSchema,
          idSchema: UUID,
          orderHint: {
            'zh-TW': '依組織樹與顯示名稱排序',
            'en-US': 'In tree order, then by display name',
          },
          iterate: (scope) => this.iterateMembers(scope),
          count: async (scope) => {
            let total = 0;
            for await (const page of this.iterateMembers(scope)) total += page.length;
            return total;
          },
        },
        importer: {
          modes: {
            create: { permissions: [PERMISSION.ORG_UNIT_UPDATE] },
            update: { permissions: [PERMISSION.ORG_UNIT_UPDATE] },
          },
          resolveTargets: (_column, values) => this.resolveMemberTargets(values),
          findTargetsById: async (ids) => {
            const found = await this.resolveMemberTargets(ids);
            return new Map(
              [...found].flatMap(([id, matches]) => (matches[0] ? [[id, matches[0]]] : [])),
            );
          },
          validateRows: (mode, rows, ctx) => this.validateMemberRows(mode, rows, ctx),
          sampleRecords: async (_ctx, limit) => {
            const rows: OrgUnitMemberExportRow[] = [];
            for await (const page of this.iterateMembers({ kind: 'filter', filter: {} })) {
              rows.push(...page);
              if (rows.length >= limit) break;
            }
            return rows.slice(0, limit);
          },
          create: async (values, ctx, tx) => {
            const unitId = String(values.unit);
            const userId = String(values.user);
            const { after } = await this.units.updateMembersInTx(
              unitId,
              {
                add: [
                  {
                    userId,
                    ...(typeof values.isManager === 'boolean'
                      ? { isManager: values.isManager }
                      : {}),
                    ...(typeof values.isPrimary === 'boolean'
                      ? { isPrimary: values.isPrimary }
                      : {}),
                    ...(typeof values.title === 'string' ? { title: values.title } : {}),
                  },
                ],
                update: [],
                remove: [],
              },
              ctx.actor,
              tx,
            );
            // 結果的紀錄是使用者（`result_id` 是 uuid；「查看紀錄」連到那個人）
            return { id: userId, after: toEffects(after) };
          },
          update: async (target, patch, ctx, tx) => {
            const [unitId = '', userId = ''] = target.id.split(':');
            const { after } = await this.units.updateMembersInTx(
              unitId,
              {
                add: [],
                update: [
                  {
                    userId,
                    ...('isManager' in patch ? { isManager: Boolean(patch.isManager) } : {}),
                    ...('isPrimary' in patch ? { isPrimary: Boolean(patch.isPrimary) } : {}),
                    ...('title' in patch ? { title: (patch.title as string | null) ?? null } : {}),
                  },
                ],
                remove: [],
              },
              ctx.actor,
              tx,
            );
            return { id: userId, after: toEffects(after) };
          },
        },
      }),
    );
  }

  private async unitsInScope(scope: ExportScope<OrgUnitExportFilter>): Promise<OrgUnitExportRow[]> {
    const tree = await this.tree();
    let units = tree.ordered();
    if (scope.kind === 'ids') {
      const ids = new Set(scope.ids);
      units = units.filter((unit) => ids.has(unit.id));
    } else if (scope.filter.keyword) {
      const matched = new Set(await this.repo.matchKeyword(scope.filter.keyword));
      units = units.filter((unit) => matched.has(unit.id));
    }
    return units.map((unit) => tree.toExportRow(unit));
  }

  private async *iterateUnits(
    scope: ExportScope<OrgUnitExportFilter>,
  ): AsyncIterable<readonly OrgUnitExportRow[]> {
    const rows = await this.unitsInScope(scope);
    for (let index = 0; index < rows.length; index += DATA_TRANSFER_EXPORT_PAGE_SIZE) {
      yield rows.slice(index, index + DATA_TRANSFER_EXPORT_PAGE_SIZE);
    }
  }

  /** 部門依組織樹的順序分批讀成員，每批湊滿一頁再交出。 */
  private async *iterateMembers(
    scope: ExportScope<OrgUnitMemberExportFilter>,
  ): AsyncIterable<readonly OrgUnitMemberExportRow[]> {
    const tree = await this.tree();
    let unitIds = tree.ordered().map((unit) => unit.id);
    if (scope.kind === 'ids') {
      const ids = new Set(scope.ids);
      unitIds = unitIds.filter((id) => ids.has(id));
    } else if (scope.filter.unitId) {
      const wanted = new Set(
        scope.filter.includeDescendants ? tree.subtree(scope.filter.unitId) : [scope.filter.unitId],
      );
      unitIds = unitIds.filter((id) => wanted.has(id));
    }
    let buffer: OrgUnitMemberExportRow[] = [];
    for (let index = 0; index < unitIds.length; index += UNITS_PER_QUERY) {
      const chunk = unitIds.slice(index, index + UNITS_PER_QUERY);
      const order = new Map(chunk.map((id, position) => [id, position]));
      const members = (await this.repo.membersOfUnits(chunk)).toSorted(
        (a, b) => (order.get(a.unitId) ?? 0) - (order.get(b.unitId) ?? 0),
      );
      for (const member of members) {
        buffer.push({
          ...member,
          unit: tree.labelOf(member.unitId),
          unitPath: tree.pathOf(member.unitId).join(PATH_SEPARATOR),
        });
      }
      while (buffer.length >= DATA_TRANSFER_EXPORT_PAGE_SIZE) {
        yield buffer.slice(0, DATA_TRANSFER_EXPORT_PAGE_SIZE);
        buffer = buffer.slice(DATA_TRANSFER_EXPORT_PAGE_SIZE);
      }
    }
    if (buffer.length) yield buffer;
  }

  private async resolveUnitTargets(
    column: string,
    values: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MatchResult<OrgUnitExportRow>[]>> {
    const tree = await this.tree();
    const result = new Map<string, MatchResult<OrgUnitExportRow>[]>();
    for (const value of values) {
      const key = value.toLowerCase();
      const unit =
        column === 'id'
          ? UUID_PATTERN.test(value)
            ? tree.byId.get(key)
            : undefined
          : [...tree.byId.values()].find((item) => item.code?.toLowerCase() === key);
      if (!unit) continue;
      result.set(key, [
        { id: unit.id, label: unit.name, version: unit.version, record: tree.toExportRow(unit) },
      ]);
    }
    return result;
  }

  private async resolveMemberTargets(
    values: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MatchResult<OrgUnitMemberExportRow>[]>> {
    const pairs = values.flatMap((value) => {
      const match = MEMBERSHIP_ID_PATTERN.exec(value);
      return match?.[1] && match[2]
        ? [{ unitId: match[1].toLowerCase(), userId: match[2].toLowerCase() }]
        : [];
    });
    if (!pairs.length) return new Map();
    const [found, tree] = await Promise.all([this.repo.findMemberships(pairs), this.tree()]);
    const result = new Map<string, MatchResult<OrgUnitMemberExportRow>[]>();
    for (const [key, row] of found) {
      result.set(key.toLowerCase(), [
        {
          id: key,
          label: `${tree.labelOf(row.unitId)} · ${row.email}`,
          version: 1,
          record: {
            ...row,
            unit: tree.labelOf(row.unitId),
            unitPath: tree.pathOf(row.unitId).join(PATH_SEPARATOR),
          },
        },
      ]);
    }
    return result;
  }

  private async resolveUsers(
    values: readonly string[],
  ): Promise<ReadonlyMap<string, ResolvedReference>> {
    const rows = await this.repo.findActiveUsersByEmails(values);
    const result = new Map<string, ResolvedReference>();
    for (const value of values) {
      const key = value.trim().toLowerCase();
      const user =
        rows.find((row) => row.email.toLowerCase() === key) ?? rows.find((row) => row.id === key);
      if (user) result.set(key, { id: user.id, label: user.email });
    }
    return result;
  }

  /**
   * 部門特有的檢查（套用時 `OrgUnitService` 會再檢查一次）：
   * - 同一個上層之下已經有同名的部門 → `alreadyExists`（上層是檔案裡的列時，套用時才知道）。
   * - 修改模式把部門搬到自己或自己的下層之下 → `referenceCycle`。
   */
  private async validateUnitRows(
    mode: 'create' | 'update',
    rows: readonly ResolvedRow[],
  ): Promise<ReadonlyMap<number, readonly RowIssue[]>> {
    const issues = new Map<number, RowIssue[]>();
    const push = (rowNo: number, issue: RowIssue) =>
      issues.set(rowNo, [...(issues.get(rowNo) ?? []), issue]);
    const tree = await this.tree();
    const siblingsOf = (parentId: string | null) =>
      [...tree.byId.values()].filter((unit) => (unit.parentId ?? null) === parentId);
    for (const row of rows) {
      const target = row.target?.record as OrgUnitExportRow | undefined;
      const parentValue = row.values.parent;
      // 同檔引用的佔位值（不是字串）：上層還不存在，同名檢查留給套用
      const parentKnown =
        parentValue === undefined || parentValue === null || typeof parentValue === 'string';
      if (
        mode === 'update' &&
        target &&
        'parent' in row.values &&
        typeof parentValue === 'string'
      ) {
        if (tree.subtree(target.id).includes(parentValue)) {
          push(row.rowNo, {
            column: 'parent',
            code: 'referenceCycle',
            params: { value: tree.labelOf(parentValue) },
            severity: 'error',
          });
          continue;
        }
      }
      if (!parentKnown) continue;
      const name =
        typeof row.values.name === 'string'
          ? row.values.name
          : mode === 'update'
            ? target?.name
            : undefined;
      if (!name) continue;
      const parentId =
        typeof parentValue === 'string'
          ? parentValue
          : parentValue === null
            ? null
            : mode === 'update'
              ? (target?.parentId ?? null)
              : null;
      // 名稱或上層有變（或新增）才檢查
      if (mode === 'update' && !row.changed?.some((key) => key === 'name' || key === 'parent'))
        continue;
      const taken = siblingsOf(parentId).find(
        (unit) => unit.id !== target?.id && unit.name.toLowerCase() === name.toLowerCase(),
      );
      if (taken) {
        push(row.rowNo, {
          column: 'name',
          code: 'alreadyExists',
          params: { value: name },
          severity: 'error',
        });
      }
    }
    return issues;
  }

  /**
   * 部門成員特有的檢查：不能改自己（D6）→ `selfModify`；已經是成員（新增模式）→ `alreadyExists`；
   * 同一批裡同一個人有兩個主要部門 → `primaryConflict`。
   */
  private async validateMemberRows(
    mode: 'create' | 'update',
    rows: readonly ResolvedRow[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<number, readonly RowIssue[]>> {
    const issues = new Map<number, RowIssue[]>();
    const push = (rowNo: number, issue: RowIssue) =>
      issues.set(rowNo, [...(issues.get(rowNo) ?? []), issue]);
    const userOf = (row: ResolvedRow): string | undefined =>
      mode === 'create'
        ? typeof row.values.user === 'string'
          ? row.values.user
          : undefined
        : (row.target?.record as OrgUnitMemberExportRow | undefined)?.userId;
    const unitOf = (row: ResolvedRow): string | undefined =>
      mode === 'create'
        ? typeof row.values.unit === 'string'
          ? row.values.unit
          : undefined
        : (row.target?.record as OrgUnitMemberExportRow | undefined)?.unitId;

    const existing =
      mode === 'create'
        ? await this.repo.findMemberships(
            rows.flatMap((row) => {
              const unitId = unitOf(row);
              const userId = userOf(row);
              return unitId && userId ? [{ unitId, userId }] : [];
            }),
          )
        : new Map();
    const primaries = new Map<string, number[]>();
    for (const row of rows) {
      const userId = userOf(row);
      const unitId = unitOf(row);
      if (!userId || !unitId) continue;
      if (userId === ctx.actor.id) {
        push(row.rowNo, {
          column: mode === 'create' ? 'user' : null,
          code: 'selfModify',
          severity: 'error',
        });
        continue;
      }
      if (existing.has(`${unitId}:${userId}`)) {
        push(row.rowNo, {
          column: 'user',
          code: 'alreadyExists',
          params: { value: String(row.values.user ?? '') },
          severity: 'error',
        });
        continue;
      }
      if (row.values.isPrimary === true) {
        primaries.set(userId, [...(primaries.get(userId) ?? []), row.rowNo]);
      }
    }
    for (const rowNos of primaries.values()) {
      if (rowNos.length < 2) continue;
      for (const rowNo of rowNos) {
        push(rowNo, {
          column: 'isPrimary',
          code: 'primaryConflict',
          params: { rows: rowNos },
          severity: 'error',
        });
      }
    }
    return issues;
  }
}

/** 成員匯出一次查詢的部門數。 */
const UNITS_PER_QUERY = 200;

/** `OrgUnitService` 的交易後副作用 → 框架可合併的推播。 */
function toEffects(after: OrgUnitAfterCommit): AfterCommitEffect[] {
  return after.changes.map((change) => ({
    kind: 'resourceChanged' as const,
    change,
    affectedUserIds: after.affectedUserIds,
  }));
}
