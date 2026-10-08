import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import { AppException } from '@/core/errors';
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
import { PermissionService } from '@/modules/permission/permission.service';

import { CreateUserSchema } from './dto/create-user.dto';
import { ListUserSchema } from './dto/list-user.dto';
import { UpdateUserSchema } from './dto/update-user.dto';
import type {
  UserExportCursor,
  UserExportScope,
  UserFilter,
  UserWithRoles,
} from './user.repository';
import { UserRepository } from './user.repository';
import { displayStatusOf, UserService } from './user.service';
import type { UserAfterCommit } from './user.service';

/** 匯出的篩選條件：列表的 query 去掉分頁與排序（匯出固定依建立時間排序，§6.2）。 */
const UserExportFilterSchema = ListUserSchema.omit({ offset: true, limit: true, sort: true });
type UserExportFilter = z.infer<typeof UserExportFilterSchema>;

const UUID = z.string().uuid();
/** 自動完成與比對目標下拉選單一次的筆數。 */
const SUGGEST_LIMIT = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 狀態的選項；`locked` 是顯示用的（`active` ＋ 鎖定中），只會出現在匯出。 */
const STATUS_OPTIONS = [
  { value: 'pending', label: { 'zh-TW': '待啟用', 'en-US': 'Pending' } },
  { value: 'active', label: { 'zh-TW': '啟用', 'en-US': 'Active' }, aliases: ['enabled'] },
  { value: 'inactive', label: { 'zh-TW': '停用', 'en-US': 'Inactive' }, aliases: ['disabled'] },
  { value: 'locked', label: { 'zh-TW': '鎖定', 'en-US': 'Locked' } },
] as const;

type UserRecord = UserWithRoles;

/** 匯入時只能 `active ⇄ inactive`；`pending`、`locked` 不能由匯入改變（§7.5）。 */
const STATUS_TRANSITIONS = { active: ['inactive'], inactive: ['active'] } as const;

/**
 * 使用者的匯入匯出（docs/architecture/backend/22-data-transfer.md §2「第一批」）。一份欄位定義同時供匯出與匯入（D4）；
 * 驗證直接取用 API 的 DTO 欄位，套用走 `UserService` 的交易內版本：業務規則（email 重複、反提權、最後一位 super-admin）只寫一次。
 */
@Injectable()
export class UserTransferResource implements OnModuleInit {
  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly repo: UserRepository,
    private readonly users: UserService,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    const columns: TransferColumn<UserRecord>[] = [
      {
        key: 'id',
        label: { 'zh-TW': 'ID', 'en-US': 'ID' },
        kind: 'string',
        hint: {
          'zh-TW': '修改模式的比對鍵：有填就只用它比對，找不到不會改用 Email。',
          'en-US': 'Match key in update mode: when filled, only the ID is used to find the user.',
        },
        export: { get: (user) => user.id },
        import: { modes: ['update'], matchKey: 1, schema: UUID },
      },
      {
        key: 'email',
        label: { 'zh-TW': 'Email', 'en-US': 'Email' },
        aliases: ['e-mail', 'mail', '電子郵件', '信箱'],
        kind: 'string',
        example: 'alice@example.com',
        hint: {
          'zh-TW': '新增模式必填、不可重複；修改模式沒有 ID 時以它比對（不能修改）。',
          'en-US':
            'Required and unique when creating; used to find the user in update mode when ID is empty (cannot be changed).',
        },
        export: { get: (user) => user.email },
        import: {
          modes: ['create', 'update'],
          requiredOnCreate: true,
          matchKey: 2,
          schema: CreateUserSchema.shape.email,
          suggest: async (keyword) =>
            (await this.repo.searchForImport(keyword, SUGGEST_LIMIT)).map((user) => user.email),
        },
      },
      {
        key: 'username',
        label: { 'zh-TW': '帳號', 'en-US': 'Username' },
        aliases: ['user name', '使用者名稱'],
        kind: 'string',
        example: 'alice',
        hint: { 'zh-TW': '3～50 字，不可重複。', 'en-US': '3–50 characters, unique.' },
        export: { get: (user) => user.username },
        import: {
          modes: ['create', 'update'],
          nullable: true,
          schema: z.string().trim().min(3).max(50),
          suggest: async (keyword) =>
            (await this.repo.searchForImport(keyword, SUGGEST_LIMIT)).flatMap((user) =>
              user.username ? [user.username] : [],
            ),
        },
      },
      {
        key: 'displayName',
        label: { 'zh-TW': '顯示名稱', 'en-US': 'Display name' },
        aliases: ['name', '名稱', '姓名'],
        kind: 'string',
        example: 'Alice Chen',
        export: { get: (user) => user.displayName },
        import: {
          modes: ['create', 'update'],
          requiredOnCreate: true,
          schema: CreateUserSchema.shape.displayName,
        },
      },
      {
        key: 'status',
        label: { 'zh-TW': '狀態', 'en-US': 'Status' },
        kind: 'enum',
        enum: STATUS_OPTIONS,
        hint: {
          'zh-TW': '只能在「啟用」與「停用」之間切換；新建立的帳號一律寄出啟用信。',
          'en-US':
            'Can only switch between Active and Inactive; new accounts always receive an activation email.',
        },
        export: { get: (user) => displayStatusOf(user) },
        import: {
          modes: ['update'],
          schema: UpdateUserSchema.shape.status.unwrap(),
          transitions: STATUS_TRANSITIONS,
        },
      },
      {
        key: 'roles',
        label: { 'zh-TW': '角色', 'en-US': 'Roles' },
        aliases: ['role'],
        kind: 'reference',
        multiple: { max: 20 },
        permission: PERMISSION.ROLE_READ,
        hint: {
          'zh-TW': '角色名稱；修改模式是整組取代。',
          'en-US': 'Role names. In update mode the whole set is replaced.',
        },
        reference: {
          resolve: (names) => this.resolveRoles(names),
          search: async (keyword) =>
            (await this.repo.searchActiveRoles(keyword, 20)).map((role) => ({
              id: role.id,
              label: role.name,
            })),
        },
        export: { get: (user) => user.roles.map((role) => role.name) },
        import: {
          modes: ['create', 'update'],
          permission: PERMISSION.USER_ASSIGN_ROLE,
          schema: z.string().trim().min(1).max(100),
        },
      },
      {
        key: 'lastLoginAt',
        label: { 'zh-TW': '最後登入', 'en-US': 'Last sign-in' },
        kind: 'datetime',
        export: { get: (user) => user.lastLoginAt },
      },
      {
        key: 'mfaEnabled',
        label: { 'zh-TW': '已設定 MFA', 'en-US': 'MFA enabled' },
        kind: 'boolean',
        export: { get: (user) => user.mfaEnabled },
      },
      {
        key: 'createdAt',
        label: { 'zh-TW': '建立時間', 'en-US': 'Created at' },
        kind: 'datetime',
        export: { get: (user) => user.createdAt },
      },
    ];

    this.registry.register(
      defineTransferResource<UserExportFilter, UserRecord>({
        type: 'user',
        fileBaseName: 'users',
        label: { 'zh-TW': '使用者', 'en-US': 'Users' },
        columns,
        exporter: {
          permissions: [PERMISSION.USER_EXPORT],
          filterSchema: UserExportFilterSchema,
          idSchema: UUID,
          orderHint: { 'zh-TW': '依建立時間排序', 'en-US': 'Sorted by creation time' },
          iterate: (scope) => this.iterate(scope),
          count: async (scope) => this.repo.exportCount(await this.toScope(scope)),
        },
        importer: {
          modes: {
            create: { permissions: [PERMISSION.USER_CREATE] },
            update: { permissions: [PERMISSION.USER_UPDATE] },
          },
          uniqueColumns: ['email', 'username'],
          findExisting: (column, values) =>
            this.repo.findTakenValues(column === 'username' ? 'username' : 'email', values),
          resolveTargets: (column, values) => this.resolveTargets(column, values),
          findTargetsById: async (ids) => {
            const found = await this.resolveTargets('id', ids);
            return new Map(
              [...found].flatMap(([id, matches]) => (matches[0] ? [[id, matches[0]]] : [])),
            );
          },
          searchTargets: async (keyword) =>
            (await this.repo.searchForImport(keyword, SUGGEST_LIMIT)).map((user) => ({
              id: user.id,
              label: user.email,
              description: user.username
                ? `${user.displayName} (${user.username})`
                : user.displayName,
            })),
          validateRows: (mode, rows, ctx) => this.validateRows(mode, rows, ctx),
          sampleRecords: (_ctx, limit) => this.repo.exportPage({ filter: {} }, null, limit),
          create: async (values, ctx, tx) => {
            const { user, after } = await this.users.createInTx(
              {
                email: String(values.email),
                ...(typeof values.username === 'string' ? { username: values.username } : {}),
                displayName: String(values.displayName),
                roleIds: Array.isArray(values.roles) ? values.roles.map(String) : [],
              },
              ctx.actor,
              tx,
            );
            return { id: user.id, after: toEffects(after, this.users) };
          },
          update: async (target, patch, ctx, tx) => {
            const effects: AfterCommitEffect[] = [];
            const fields: {
              username?: string | null;
              displayName?: string;
              status?: 'active' | 'inactive';
            } = {};
            if ('username' in patch) fields.username = (patch.username as string | null) ?? null;
            if ('displayName' in patch) fields.displayName = String(patch.displayName);
            if ('status' in patch) fields.status = patch.status as 'active' | 'inactive';
            if (Object.keys(fields).length) {
              const { after } = await this.users.updateInTx(
                target.id,
                { ...fields, version: target.version },
                ctx.actor,
                tx,
              );
              effects.push(...toEffects(after, this.users));
            }
            if ('roles' in patch) {
              // 多值欄整組取代：以比對當下的角色集合當 expectedRoleIds，沿用 PUT /users/:id/roles 的衝突檢查
              const expected = target.expected?.roleIds;
              const { after } = await this.users.replaceRolesInTx(
                target.id,
                {
                  roleIds: Array.isArray(patch.roles) ? patch.roles.map(String) : [],
                  expectedRoleIds: Array.isArray(expected) ? expected.map(String) : [],
                },
                ctx.actor,
                tx,
              );
              effects.push(...toEffects(after, this.users));
            }
            return { id: target.id, after: effects };
          },
        },
      }),
    );
  }

  /** 匯出的範圍；列表的部門篩選展開成部門 id（docs/architecture/backend/23-organization.md §4）。 */
  private async toScope(scope: ExportScope<UserExportFilter>): Promise<UserExportScope> {
    if (scope.kind === 'ids') return { ids: scope.ids };
    const { orgUnitId, includeDescendants, ...filter } = scope.filter;
    const orgUnitIds = await this.users.orgUnitScope({ orgUnitId, includeDescendants });
    return { filter: { ...(filter as UserFilter), orgUnitIds } };
  }

  private async *iterate(
    scope: ExportScope<UserExportFilter>,
  ): AsyncIterable<readonly UserRecord[]> {
    let after: UserExportCursor | null = null;
    const resolved = await this.toScope(scope);
    for (;;) {
      const page = await this.repo.exportPage(resolved, after, DATA_TRANSFER_EXPORT_PAGE_SIZE);
      if (page.length) yield page;
      const last = page.at(-1);
      if (!last || page.length < DATA_TRANSFER_EXPORT_PAGE_SIZE) return;
      after = { createdAt: last.createdAt, id: last.id };
    }
  }

  private async resolveRoles(
    names: readonly string[],
  ): Promise<ReadonlyMap<string, ResolvedReference>> {
    const rows = await this.repo.findActiveRolesByNames(names);
    const result = new Map<string, ResolvedReference>();
    for (const name of names) {
      const key = name.trim().toLowerCase();
      // 名稱、代碼、id 依序比對：代碼與 id 唯一，名稱也唯一（`lower(name)`），所以同一個輸入最多一個角色
      const role =
        rows.find((row) => row.name.toLowerCase() === key) ??
        rows.find((row) => row.slug.toLowerCase() === key) ??
        rows.find((row) => row.id === key);
      if (role) result.set(key, { id: role.id, label: role.name });
    }
    return result;
  }

  private async resolveTargets(
    column: string,
    values: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MatchResult<UserRecord>[]>> {
    const byId = column === 'id';
    const valid = byId ? values.filter((value) => UUID_PATTERN.test(value)) : values;
    const rows = await this.repo.findForImport(byId ? 'id' : 'email', valid);
    const result = new Map<string, MatchResult<UserRecord>[]>();
    for (const row of rows) {
      const key = (byId ? row.id : row.email).toLowerCase();
      const list = result.get(key) ?? [];
      list.push({
        id: row.id,
        label: row.email,
        version: row.version,
        record: row,
        expected: { roleIds: row.roles.map((role) => role.id) },
      });
      result.set(key, list);
    }
    return result;
  }

  /**
   * 使用者特有的檢查：角色是否可指派（反提權，`roleNotAssignable { names }`）、修改自己的狀態或角色（`selfModify`）。
   * 只回傳問題，不寫資料；套用時 `UserService` 會再檢查一次（例：權限在預覽之後被拿掉）。
   */
  private async validateRows(
    mode: 'create' | 'update',
    rows: readonly ResolvedRow[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<number, readonly RowIssue[]>> {
    const issues = new Map<number, RowIssue[]>();
    const push = (rowNo: number, issue: RowIssue) =>
      issues.set(rowNo, [...(issues.get(rowNo) ?? []), issue]);
    const roleIds = new Set<string>();
    for (const row of rows) {
      if (Array.isArray(row.values.roles))
        for (const id of row.values.roles) roleIds.add(String(id));
    }
    const denied = new Set<string>();
    for (const id of roleIds) {
      try {
        await this.permissions.assertRolesAssignable(ctx.actor.id, [id]);
      } catch (error) {
        if (!(error instanceof AppException)) throw error;
        denied.add(id);
      }
    }
    const names = denied.size ? await this.repo.findActiveRolesByIds([...denied]) : [];
    const nameOf = new Map(names.map((role) => [role.id, role.name]));
    for (const row of rows) {
      const roles = Array.isArray(row.values.roles) ? row.values.roles.map(String) : [];
      const blocked = roles.filter((id) => denied.has(id));
      if (blocked.length && (mode === 'create' || row.changed?.includes('roles'))) {
        push(row.rowNo, {
          column: 'roles',
          code: 'roleNotAssignable',
          params: { names: blocked.map((id) => nameOf.get(id) ?? id) },
          severity: 'error',
        });
      }
      if (mode === 'update' && row.target?.id === ctx.actor.id) {
        for (const key of ['status', 'roles'] as const) {
          if (row.changed?.includes(key))
            push(row.rowNo, { column: key, code: 'selfModify', severity: 'error' });
        }
      }
    }
    return issues;
  }
}

/** `UserService` 的交易後副作用 → 框架可合併的副作用（權限失效只做一次、推播合併）。 */
function toEffects(after: UserAfterCommit, users: UserService): AfterCommitEffect[] {
  const effects: AfterCommitEffect[] = [];
  if (after.permissionsChanged?.length) {
    effects.push({ kind: 'permissionsChanged', userIds: after.permissionsChanged });
  }
  if (after.invalidateAccount || after.sessionsRevoked?.length) {
    const id = after.invalidateAccount ?? after.sessionsRevoked?.[0] ?? '';
    effects.push({
      kind: 'custom',
      key: `user.account:${id}`,
      run: () =>
        users.runAfterCommit({
          invalidateAccount: after.invalidateAccount,
          sessionsRevoked: after.sessionsRevoked,
          changes: [],
        }),
    });
  }
  for (const change of after.changes) {
    effects.push({ kind: 'resourceChanged', change, affectedUserIds: after.affectedUserIds });
  }
  return effects;
}
