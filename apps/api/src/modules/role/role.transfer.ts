import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import type { PermissionKey } from '@/common/types';
import { ALL_PERMISSION_KEYS } from '@/db/seeds/permissions';
import { DataTransferRegistry } from '@/modules/data-transfer/data-transfer-registry.service';
import { DATA_TRANSFER_EXPORT_PAGE_SIZE } from '@/modules/data-transfer/data-transfer.constants';
import { defineTransferResource } from '@/modules/data-transfer/data-transfer.definition';
import type {
  AfterCommitEffect,
  ExportScope,
  MatchResult,
  ResolvedRow,
  RowIssue,
  TransferColumn,
  TransferContext,
} from '@/modules/data-transfer/data-transfer.types';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import { PermissionService } from '@/modules/permission/permission.service';

import { CreateRoleSchema, RoleNameSchema } from './dto/create-role.dto';
import { ListRoleSchema } from './dto/list-role.dto';
import type { RoleExportCursor, RoleExportRow } from './role.repository';
import { RoleRepository } from './role.repository';
import { RoleService } from './role.service';
import type { RoleAfterCommit } from './role.service';

/** 匯出的篩選條件：列表的 query 去掉分頁與排序（匯出固定依建立時間排序）。 */
const RoleExportFilterSchema = ListRoleSchema.omit({ offset: true, limit: true, sort: true });
type RoleExportFilter = z.infer<typeof RoleExportFilterSchema>;

const UUID = z.string().uuid();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** slug 的格式與 `slugify()` 的輸出相同。 */
const SlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(50);
const SUGGEST_LIMIT = 20;

/** 權限鍵的選項：以鍵本身當名稱（跨語系、跨租戶都一樣，檔案可以直接搬到另一個租戶）。 */
const PERMISSION_OPTIONS = ALL_PERMISSION_KEYS.map((key) => ({
  value: key,
  label: { 'zh-TW': key, 'en-US': key },
}));

/**
 * 角色的匯入匯出（docs/architecture/backend/22-data-transfer.md §12.1）：主要用途是把一個租戶調好的角色搬到另一個租戶。
 * 以 slug 比對（跨租戶不變），建立時可以指定 slug；權限鍵整組取代，套用走 `RoleService` 的交易內版本：
 * 反提權、自我鎖定、super-admin 不可改的規則只寫一次。持有者不在這裡（使用者匯入的「角色」欄、群組匯入的「角色」欄）。
 */
@Injectable()
export class RoleTransferResource implements OnModuleInit {
  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly repo: RoleRepository,
    private readonly roles: RoleService,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    const columns: TransferColumn<RoleExportRow>[] = [
      {
        key: 'id',
        label: { 'zh-TW': 'ID', 'en-US': 'ID' },
        kind: 'string',
        hint: {
          'zh-TW': '修改模式的比對鍵：有填就只用它比對，找不到不會改用代碼。',
          'en-US': 'Match key in update mode: when filled, only the ID is used to find the role.',
        },
        export: { get: (role) => role.id },
        import: { modes: ['update'], matchKey: 1, schema: UUID },
      },
      {
        key: 'slug',
        label: { 'zh-TW': '代碼', 'en-US': 'Slug' },
        kind: 'string',
        example: 'support-agent',
        hint: {
          'zh-TW':
            '小寫英數字與 -，建立後不能修改。新增時不填會由名稱產生；修改模式沒有 ID 時以它比對（跨租戶搬移角色用它）。',
          'en-US':
            'Lowercase letters, digits and hyphens; cannot be changed. Generated from the name when empty; used to find the role in update mode when ID is empty.',
        },
        export: { get: (role) => role.slug },
        import: {
          modes: ['create', 'update'],
          matchKey: 2,
          schema: SlugSchema,
          suggest: async (keyword) =>
            (await this.repo.searchForImport(keyword, SUGGEST_LIMIT)).map((role) => role.slug),
        },
      },
      {
        key: 'name',
        label: { 'zh-TW': '名稱', 'en-US': 'Name' },
        aliases: ['role', '角色', '角色名稱'],
        kind: 'string',
        example: 'Support agent',
        hint: { 'zh-TW': '不可重複（不分大小寫）。', 'en-US': 'Unique (case-insensitive).' },
        export: { get: (role) => role.name },
        import: { modes: ['create', 'update'], requiredOnCreate: true, schema: RoleNameSchema },
      },
      {
        key: 'description',
        label: { 'zh-TW': '說明', 'en-US': 'Description' },
        kind: 'string',
        export: { get: (role) => role.description },
        import: {
          modes: ['create', 'update'],
          nullable: true,
          schema: CreateRoleSchema.shape.description.unwrap(),
        },
      },
      {
        key: 'permissions',
        label: { 'zh-TW': '權限', 'en-US': 'Permissions' },
        aliases: ['permission', 'permission keys', '權限鍵'],
        kind: 'enum',
        enum: PERMISSION_OPTIONS,
        multiple: { max: 100 },
        example: 'user:read;role:read',
        hint: {
          'zh-TW':
            '權限鍵（例：user:read）；修改模式是整組取代。只能授予自己持有的權限，super-admin 不可修改。',
          'en-US':
            'Permission keys (e.g. user:read). In update mode the whole set is replaced. You can only grant permissions you hold; super-admin cannot be changed.',
        },
        export: { get: (role) => role.permissionKeys },
        import: {
          modes: ['create', 'update'],
          permission: PERMISSION.ROLE_GRANT_PERMISSION,
          schema: z.enum(ALL_PERMISSION_KEYS as [string, ...string[]]),
        },
      },
      {
        key: 'isSystem',
        label: { 'zh-TW': '系統角色', 'en-US': 'System role' },
        kind: 'boolean',
        export: { get: (role) => role.isSystem },
      },
      {
        key: 'userCount',
        label: { 'zh-TW': '直接持有的人數', 'en-US': 'Direct holders' },
        kind: 'number',
        export: { get: (role) => role.userCount },
      },
      {
        key: 'createdAt',
        label: { 'zh-TW': '建立時間', 'en-US': 'Created at' },
        kind: 'datetime',
        export: { get: (role) => role.createdAt },
      },
    ];

    this.registry.register(
      defineTransferResource<RoleExportFilter, RoleExportRow>({
        type: 'role',
        fileBaseName: 'roles',
        label: { 'zh-TW': '角色', 'en-US': 'Roles' },
        columns,
        exporter: {
          permissions: [PERMISSION.ROLE_EXPORT],
          filterSchema: RoleExportFilterSchema,
          idSchema: UUID,
          orderHint: { 'zh-TW': '依建立時間排序', 'en-US': 'Sorted by creation time' },
          iterate: (scope) => this.iterate(scope),
          count: (scope) => this.repo.exportCount(toScope(scope)),
        },
        importer: {
          modes: {
            create: { permissions: [PERMISSION.ROLE_CREATE] },
            update: { permissions: [PERMISSION.ROLE_UPDATE] },
          },
          uniqueColumns: ['slug', 'name'],
          findExisting: (column, values) =>
            this.repo.findTakenValues(column === 'slug' ? 'slug' : 'name', values),
          resolveTargets: (column, values) => this.resolveTargets(column, values),
          findTargetsById: async (ids) => {
            const found = await this.resolveTargets('id', ids);
            return new Map(
              [...found].flatMap(([id, matches]) => (matches[0] ? [[id, matches[0]]] : [])),
            );
          },
          searchTargets: async (keyword) =>
            (await this.repo.searchForImport(keyword, SUGGEST_LIMIT)).map((role) => ({
              id: role.id,
              label: role.name,
              description: role.slug,
            })),
          validateRows: (mode, rows, ctx) => this.validateRows(mode, rows, ctx),
          sampleRecords: (_ctx, limit) => this.repo.exportPage({ filter: {} }, null, limit),
          create: async (values, ctx, tx) => {
            const { role, after } = await this.roles.createInTx(
              {
                name: String(values.name),
                ...(typeof values.description === 'string'
                  ? { description: values.description }
                  : {}),
                ...(typeof values.slug === 'string' ? { slug: values.slug } : {}),
                permissionKeys: Array.isArray(values.permissions)
                  ? (values.permissions as PermissionKey[])
                  : [],
              },
              ctx.actor,
              tx,
            );
            return { id: role.id, after: toEffects(after) };
          },
          update: async (target, patch, ctx, tx) => {
            const effects: AfterCommitEffect[] = [];
            let version = target.version;
            if ('name' in patch || 'description' in patch) {
              const { role, after } = await this.roles.updateInTx(
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
              version = role.version;
              effects.push(...toEffects(after));
            }
            if ('permissions' in patch) {
              // 多值欄整組取代：以比對當下的權限鍵當 expectedKeys，預覽之後別人改過就衝突，不蓋掉別人的修改
              const expected = target.expected?.permissionKeys;
              const { after } = await this.roles.replacePermissionsInTx(
                target.id,
                {
                  keys: Array.isArray(patch.permissions) ? patch.permissions.map(String) : [],
                  ...(Array.isArray(expected) ? { expectedKeys: expected.map(String) } : {}),
                },
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

  private async *iterate(
    scope: ExportScope<RoleExportFilter>,
  ): AsyncIterable<readonly RoleExportRow[]> {
    let after: RoleExportCursor | null = null;
    for (;;) {
      const page = await this.repo.exportPage(
        toScope(scope),
        after,
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
      if (page.length) yield page;
      const last = page.at(-1);
      if (!last || page.length < DATA_TRANSFER_EXPORT_PAGE_SIZE) return;
      after = { createdAt: last.createdAt, id: last.id };
    }
  }

  private async resolveTargets(
    column: string,
    values: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MatchResult<RoleExportRow>[]>> {
    const byId = column === 'id';
    const valid = byId ? values.filter((value) => UUID_PATTERN.test(value)) : values;
    const rows = await this.repo.findForImport(byId ? 'id' : 'slug', valid);
    const result = new Map<string, MatchResult<RoleExportRow>[]>();
    for (const row of rows) {
      const key = (byId ? row.id : row.slug).toLowerCase();
      result.set(key, [
        ...(result.get(key) ?? []),
        {
          id: row.id,
          label: row.name,
          version: row.version,
          record: row,
          expected: { permissionKeys: row.permissionKeys },
        },
      ]);
    }
    return result;
  }

  /**
   * 角色特有的檢查（只回傳問題，套用時 `RoleService` 會再檢查一次）：
   * - 授予自己沒有的權限（反提權）→ `permissionNotGrantable { names }`；修改模式只看新增的鍵。
   * - super-admin 不可修改 → `immutable`。
   */
  private async validateRows(
    mode: 'create' | 'update',
    rows: readonly ResolvedRow[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<number, readonly RowIssue[]>> {
    const issues = new Map<number, RowIssue[]>();
    const push = (rowNo: number, issue: RowIssue) =>
      issues.set(rowNo, [...(issues.get(rowNo) ?? []), issue]);
    const { permissions, isSuperAdmin } = await this.permissions.getPermissionSet(ctx.actor.id);
    for (const row of rows) {
      const record = row.target?.record as RoleExportRow | undefined;
      if (mode === 'update' && record?.slug === SUPER_ADMIN_SLUG && row.changed?.length) {
        push(row.rowNo, { column: null, code: 'immutable', severity: 'error' });
        continue;
      }
      if (isSuperAdmin || !Array.isArray(row.values.permissions)) continue;
      if (mode === 'update' && !row.changed?.includes('permissions')) continue;
      const current = new Set(record?.permissionKeys ?? []);
      const denied = row.values.permissions
        .map(String)
        .filter((key) => !current.has(key) && !permissions.has(key as PermissionKey));
      if (denied.length) {
        push(row.rowNo, {
          column: 'permissions',
          code: 'permissionNotGrantable',
          params: { names: denied },
          severity: 'error',
        });
      }
    }
    return issues;
  }
}

function toScope(scope: ExportScope<RoleExportFilter>) {
  return scope.kind === 'ids' ? { ids: scope.ids } : { filter: scope.filter };
}

/** `RoleService` 的交易後副作用 → 框架可合併的副作用（權限失效只做一次、推播合併）。 */
function toEffects(after: RoleAfterCommit): AfterCommitEffect[] {
  return [
    ...(after.permissionsChanged
      ? [{ kind: 'permissionsChanged' as const, userIds: after.permissionsChanged }]
      : []),
    ...after.changes.map((change) => ({
      kind: 'resourceChanged' as const,
      change,
      affectedUserIds: after.affectedUserIds,
    })),
  ];
}
