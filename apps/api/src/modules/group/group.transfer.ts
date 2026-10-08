import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { GROUP_MEMBER_RELATION, GROUP_OBJECT_TYPE, parseSubjectKey } from '@/core/authz';
import { AppException } from '@/core/errors';
import type { GroupMemberSubject } from '@/db/schema';
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
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import { PermissionService } from '@/modules/permission/permission.service';

import { CreateGroupSchema, GroupNameSchema } from './dto/create-group.dto';
import { ListGroupSchema } from './dto/list-group.dto';
import type {
  GroupExportCursor,
  GroupExportRow,
  GroupMembershipCursor,
  GroupMembershipRow,
} from './group.repository';
import { GroupRepository } from './group.repository';
import { GroupService } from './group.service';
import type { GroupAfterCommit } from './group.service';

/** 匯出的篩選條件：列表的 query 去掉分頁與排序（匯出固定依建立時間排序）。 */
const GroupExportFilterSchema = ListGroupSchema.omit({ offset: true, limit: true, sort: true });
type GroupExportFilter = z.infer<typeof GroupExportFilterSchema>;

/** 成員的匯出：某一個群組的成員（群組詳情），或全部。勾選的範圍是群組的 id（群組列表的「匯出成員」）。 */
const GroupMemberExportFilterSchema = z.object({ groupId: z.string().uuid().optional() });
type GroupMemberExportFilter = z.infer<typeof GroupMemberExportFilterSchema>;

const UUID = z.string().uuid();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUGGEST_LIMIT = 20;
const ReferenceText = z.string().trim().min(1).max(320);

/**
 * 群組與群組成員的匯入匯出（docs/architecture/backend/22-data-transfer.md §12.2）。兩種資源：
 * - `group`：名稱、說明、持有的角色（整組取代）。
 * - `groupMember`：一列一筆直接成員關係（使用者或另一個群組），只有新增模式（加成員）；移除成員在畫面上做。
 * 套用走 `GroupService` 的交易內版本：反提權（D11、D12）、不能改自己、巢狀的循環與層數都只寫一次。
 */
@Injectable()
export class GroupTransferResource implements OnModuleInit {
  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly repo: GroupRepository,
    private readonly groups: GroupService,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    this.registerGroups();
    this.registerMembers();
  }

  private registerGroups(): void {
    const columns: TransferColumn<GroupExportRow>[] = [
      {
        key: 'id',
        label: { 'zh-TW': 'ID', 'en-US': 'ID' },
        kind: 'string',
        hint: {
          'zh-TW': '修改模式的比對鍵：有填就只用它比對，找不到不會改用名稱。',
          'en-US': 'Match key in update mode: when filled, only the ID is used to find the group.',
        },
        export: { get: (group) => group.id },
        import: { modes: ['update'], matchKey: 1, schema: UUID },
      },
      {
        key: 'name',
        label: { 'zh-TW': '名稱', 'en-US': 'Name' },
        aliases: ['group', '群組', '群組名稱'],
        kind: 'string',
        example: 'Support team',
        hint: {
          'zh-TW': '不可重複（不分大小寫）；修改模式沒有 ID 時以它比對（不能修改）。',
          'en-US':
            'Unique (case-insensitive); used to find the group in update mode when ID is empty (cannot be changed).',
        },
        export: { get: (group) => group.name },
        import: {
          modes: ['create', 'update'],
          requiredOnCreate: true,
          matchKey: 2,
          schema: GroupNameSchema,
          suggest: async (keyword) =>
            (await this.repo.searchForImport(keyword, SUGGEST_LIMIT)).map((group) => group.name),
        },
      },
      {
        key: 'description',
        label: { 'zh-TW': '說明', 'en-US': 'Description' },
        kind: 'string',
        export: { get: (group) => group.description },
        import: {
          modes: ['create', 'update'],
          nullable: true,
          schema: CreateGroupSchema.shape.description.unwrap(),
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
          'zh-TW': '群組持有的角色名稱，成員都會取得；修改模式是整組取代。不能是 super-admin。',
          'en-US':
            'Roles held by the group (all members get them). In update mode the whole set is replaced. Cannot be super-admin.',
        },
        reference: {
          resolve: (names) => this.resolveRoles(names),
          search: (keyword) => this.repo.searchActiveRoles(keyword, SUGGEST_LIMIT).then(toOptions),
        },
        export: { get: (group) => group.roles.map((role) => role.name) },
        import: {
          modes: ['create', 'update'],
          permission: PERMISSION.GROUP_ASSIGN_ROLE,
          schema: ReferenceText,
        },
      },
      {
        key: 'memberCount',
        label: { 'zh-TW': '直接成員數', 'en-US': 'Direct members' },
        kind: 'number',
        export: { get: (group) => group.memberCount },
      },
      {
        key: 'createdAt',
        label: { 'zh-TW': '建立時間', 'en-US': 'Created at' },
        kind: 'datetime',
        export: { get: (group) => group.createdAt },
      },
    ];

    this.registry.register(
      defineTransferResource<GroupExportFilter, GroupExportRow>({
        type: 'group',
        feature: 'group',
        fileBaseName: 'groups',
        label: { 'zh-TW': '群組', 'en-US': 'Groups' },
        columns,
        exporter: {
          permissions: [PERMISSION.GROUP_EXPORT],
          filterSchema: GroupExportFilterSchema,
          idSchema: UUID,
          orderHint: { 'zh-TW': '依建立時間排序', 'en-US': 'Sorted by creation time' },
          iterate: (scope) => this.iterateGroups(scope),
          count: (scope) => this.repo.exportCount(toGroupScope(scope)),
        },
        importer: {
          modes: {
            create: { permissions: [PERMISSION.GROUP_CREATE] },
            update: { permissions: [PERMISSION.GROUP_UPDATE] },
          },
          uniqueColumns: ['name'],
          findExisting: (_column, values) => this.repo.findTakenNames(values),
          resolveTargets: (column, values) => this.resolveGroupTargets(column, values),
          findTargetsById: async (ids) => {
            const found = await this.resolveGroupTargets('id', ids);
            return new Map(
              [...found].flatMap(([id, matches]) => (matches[0] ? [[id, matches[0]]] : [])),
            );
          },
          searchTargets: async (keyword) =>
            (await this.repo.searchForImport(keyword, SUGGEST_LIMIT)).map((group) => ({
              id: group.id,
              label: group.name,
              ...(group.description ? { description: group.description } : {}),
            })),
          validateRows: (mode, rows, ctx) => this.validateGroupRows(mode, rows, ctx),
          sampleRecords: (_ctx, limit) => this.repo.exportPage({ filter: {} }, null, limit),
          create: async (values, ctx, tx) => {
            const { group, after } = await this.groups.createInTx(
              {
                name: String(values.name),
                ...(typeof values.description === 'string'
                  ? { description: values.description }
                  : {}),
              },
              ctx.actor,
              tx,
            );
            const effects = toEffects(after);
            const roleIds = Array.isArray(values.roles) ? values.roles.map(String) : [];
            if (roleIds.length) {
              const { after: assigned } = await this.groups.updateRolesInTx(
                group.id,
                { add: roleIds, remove: [] },
                ctx.actor,
                tx,
              );
              effects.push(...toEffects(assigned));
            }
            return { id: group.id, after: effects };
          },
          update: async (target, patch, ctx, tx) => {
            const effects: AfterCommitEffect[] = [];
            if ('description' in patch) {
              const { after } = await this.groups.updateInTx(
                target.id,
                {
                  description: (patch.description as string | null) ?? null,
                  version: target.version,
                },
                ctx.actor,
                tx,
              );
              effects.push(...toEffects(after));
            }
            if ('roles' in patch) {
              // 多值欄整組取代：以比對當下的角色當 expectedRoleIds，預覽之後別人改過就衝突
              const expected = target.expected?.roleIds;
              const { after } = await this.groups.replaceRolesInTx(
                target.id,
                {
                  roleIds: Array.isArray(patch.roles) ? patch.roles.map(String) : [],
                  ...(Array.isArray(expected) ? { expectedRoleIds: expected.map(String) } : {}),
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

  private registerMembers(): void {
    const columns: TransferColumn<GroupMembershipRow>[] = [
      {
        key: 'group',
        label: { 'zh-TW': '群組', 'en-US': 'Group' },
        aliases: ['group name', '群組名稱'],
        kind: 'reference',
        example: 'Support team',
        hint: { 'zh-TW': '群組名稱。', 'en-US': 'Group name.' },
        reference: {
          resolve: (names) => this.resolveGroups(names),
          search: (keyword) =>
            this.repo
              .searchForImport(keyword, SUGGEST_LIMIT)
              .then((rows) => rows.map((row) => ({ id: row.id, label: row.name }))),
        },
        export: { get: (row) => row.groupName },
        import: { modes: ['create'], requiredOnCreate: true, schema: ReferenceText },
      },
      {
        key: 'user',
        label: { 'zh-TW': '使用者', 'en-US': 'User' },
        aliases: ['email', 'user email', '成員', 'Email'],
        kind: 'reference',
        example: 'alice@example.com',
        hint: {
          'zh-TW': '要加入的使用者的 Email；與「成員群組」擇一填寫。',
          'en-US': 'Email of the user to add; fill either this or Member group.',
        },
        reference: {
          resolve: (values) => this.resolveUsers(values),
          search: (keyword) =>
            this.repo
              .searchActiveUsers(keyword, SUGGEST_LIMIT)
              .then((rows) => rows.map((row) => ({ id: row.id, label: row.email }))),
        },
        export: { get: (row) => (row.type === 'user' ? row.member : null) },
        import: { modes: ['create'], schema: ReferenceText },
      },
      {
        key: 'memberGroup',
        label: { 'zh-TW': '成員群組', 'en-US': 'Member group' },
        aliases: ['nested group', '子群組'],
        kind: 'reference',
        hint: {
          'zh-TW': '要放進來的群組名稱（巢狀：它的成員都算這個群組的成員）；與「使用者」擇一填寫。',
          'en-US':
            'Name of a group to nest (its members become members); fill either this or User.',
        },
        reference: {
          resolve: (names) => this.resolveGroups(names),
          search: (keyword) =>
            this.repo
              .searchForImport(keyword, SUGGEST_LIMIT)
              .then((rows) => rows.map((row) => ({ id: row.id, label: row.name }))),
        },
        export: { get: (row) => (row.type === 'group' ? row.member : null) },
        import: { modes: ['create'], schema: ReferenceText },
      },
      {
        key: 'memberName',
        label: { 'zh-TW': '成員名稱', 'en-US': 'Member name' },
        kind: 'string',
        export: { get: (row) => row.memberName },
      },
    ];

    this.registry.register(
      defineTransferResource<GroupMemberExportFilter, GroupMembershipRow>({
        type: 'groupMember',
        feature: 'group',
        fileBaseName: 'group-members',
        label: { 'zh-TW': '群組成員', 'en-US': 'Group members' },
        columns,
        exporter: {
          permissions: [PERMISSION.GROUP_EXPORT],
          filterSchema: GroupMemberExportFilterSchema,
          idSchema: UUID,
          orderHint: { 'zh-TW': '依群組名稱排序', 'en-US': 'Sorted by group name' },
          iterate: (scope) => this.iterateMembers(scope),
          count: (scope) => this.repo.exportMemberCount(toMemberScope(scope)),
        },
        importer: {
          modes: { create: { permissions: [PERMISSION.GROUP_UPDATE] } },
          validateRows: (_mode, rows, ctx) => this.validateMemberRows(rows, ctx),
          create: async (values, ctx, tx) => {
            const groupId = String(values.group);
            const member = memberOf(values);
            if (!member) throw new AppException('VALIDATION_FAILED');
            const { after } = await this.groups.updateMembersInTx(
              groupId,
              { add: [member], remove: [] },
              ctx.actor,
              tx,
            );
            return { id: groupId, after: toEffects(after) };
          },
        },
      }),
    );
  }

  private async *iterateGroups(
    scope: ExportScope<GroupExportFilter>,
  ): AsyncIterable<readonly GroupExportRow[]> {
    let after: GroupExportCursor | null = null;
    for (;;) {
      const page = await this.repo.exportPage(
        toGroupScope(scope),
        after,
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
      if (page.length) yield page;
      const last = page.at(-1);
      if (!last || page.length < DATA_TRANSFER_EXPORT_PAGE_SIZE) return;
      after = { createdAt: last.createdAt, id: last.id };
    }
  }

  private async *iterateMembers(
    scope: ExportScope<GroupMemberExportFilter>,
  ): AsyncIterable<readonly GroupMembershipRow[]> {
    let after: GroupMembershipCursor | null = null;
    for (;;) {
      const page = await this.repo.exportMembers(
        toMemberScope(scope),
        after,
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
      if (page.length) yield page;
      const last = page.at(-1);
      if (!last || page.length < DATA_TRANSFER_EXPORT_PAGE_SIZE) return;
      after = {
        groupName: last.groupName,
        groupId: last.groupId,
        type: last.type,
        memberId: last.memberId,
      };
    }
  }

  private async resolveGroupTargets(
    column: string,
    values: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MatchResult<GroupExportRow>[]>> {
    const byId = column === 'id';
    const valid = byId ? values.filter((value) => UUID_PATTERN.test(value)) : values;
    const rows = await this.repo.findForImport(byId ? 'id' : 'name', valid);
    const result = new Map<string, MatchResult<GroupExportRow>[]>();
    for (const row of rows) {
      const key = (byId ? row.id : row.name).toLowerCase();
      result.set(key, [
        ...(result.get(key) ?? []),
        {
          id: row.id,
          label: row.name,
          version: row.version,
          record: row,
          expected: { roleIds: row.roles.map((role) => role.id) },
        },
      ]);
    }
    return result;
  }

  private async resolveRoles(
    names: readonly string[],
  ): Promise<ReadonlyMap<string, ResolvedReference>> {
    const rows = await this.repo.findActiveRolesByNames(names);
    const result = new Map<string, ResolvedReference>();
    for (const name of names) {
      const key = name.trim().toLowerCase();
      // 名稱、代碼、id 都唯一：同一個輸入最多一個角色
      const role =
        rows.find((row) => row.name.toLowerCase() === key) ??
        rows.find((row) => row.slug.toLowerCase() === key) ??
        rows.find((row) => row.id === key);
      if (role) result.set(key, { id: role.id, label: role.name });
    }
    return result;
  }

  private async resolveGroups(
    names: readonly string[],
  ): Promise<ReadonlyMap<string, ResolvedReference>> {
    const rows = await this.repo.findActiveGroupsByNames(names);
    const result = new Map<string, ResolvedReference>();
    for (const name of names) {
      const key = name.trim().toLowerCase();
      const group =
        rows.find((row) => row.name.toLowerCase() === key) ?? rows.find((row) => row.id === key);
      if (group) result.set(key, { id: group.id, label: group.name });
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
   * 群組特有的檢查（套用時 `GroupService` 會再檢查一次）：持有的角色不能是 super-admin（D12）、
   * 要是自己可以指派的（反提權）、不能改自己所屬群組持有的角色。
   */
  private async validateGroupRows(
    mode: 'create' | 'update',
    rows: readonly ResolvedRow[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<number, readonly RowIssue[]>> {
    const issues = new Map<number, RowIssue[]>();
    const push = (rowNo: number, issue: RowIssue) =>
      issues.set(rowNo, [...(issues.get(rowNo) ?? []), issue]);
    const touched = rows.filter(
      (row) =>
        Array.isArray(row.values.roles) && (mode === 'create' || row.changed?.includes('roles')),
    );
    if (!touched.length) return issues;

    const roleIds = [
      ...new Set(touched.flatMap((row) => (row.values.roles as unknown[]).map(String))),
    ];
    const found = await this.repo.findActiveRoles(roleIds);
    const superAdmin = new Set(
      found.filter((role) => role.slug === SUPER_ADMIN_SLUG).map((role) => role.id),
    );
    const denied = await this.notAssignable(
      ctx.actor,
      roleIds.filter((id) => !superAdmin.has(id)),
    );
    const names = new Map(
      (await this.repo.findActiveRolesByNames(roleIds)).map((role) => [role.id, role.name]),
    );
    const own = await this.ownGroups(ctx.actor);

    for (const row of touched) {
      const ids = (row.values.roles as unknown[]).map(String);
      if (mode === 'update' && row.target && own.has(row.target.id)) {
        push(row.rowNo, { column: 'roles', code: 'selfModify', severity: 'error' });
        continue;
      }
      if (ids.some((id) => superAdmin.has(id))) {
        push(row.rowNo, { column: 'roles', code: 'superAdminForbidden', severity: 'error' });
        continue;
      }
      // 修改模式只看新增的角色：拿掉角色不是提權
      const current = new Set(
        ((row.target?.record as GroupExportRow | undefined)?.roles ?? []).map((role) => role.id),
      );
      const blocked = ids.filter((id) => denied.has(id) && !current.has(id));
      if (blocked.length) {
        push(row.rowNo, {
          column: 'roles',
          code: 'roleNotAssignable',
          params: { names: blocked.map((id) => names.get(id) ?? id) },
          severity: 'error',
        });
      }
    }
    return issues;
  }

  /**
   * 群組成員特有的檢查（套用時 `GroupService` 會再檢查一次）：
   * - 「使用者」與「成員群組」擇一 → `required`、`exactlyOne`；把群組放進自己 → `membershipCycle`。
   * - 已經是直接成員 → `alreadyExists`；把自己、自己所屬的群組放進群組 → `selfModify`（I9 的延伸）。
   * - 加入後取得的權限操作者沒有（D11）→ `escalation`。
   */
  private async validateMemberRows(
    rows: readonly ResolvedRow[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<number, readonly RowIssue[]>> {
    const issues = new Map<number, RowIssue[]>();
    const push = (rowNo: number, issue: RowIssue) =>
      issues.set(rowNo, [...(issues.get(rowNo) ?? []), issue]);
    const pending: Array<{ row: ResolvedRow; groupId: string; member: GroupMemberSubject }> = [];
    for (const row of rows) {
      const hasUser = typeof row.values.user === 'string';
      const hasGroup = typeof row.values.memberGroup === 'string';
      if (!hasUser && !hasGroup) {
        push(row.rowNo, { column: 'user', code: 'required', severity: 'error' });
        continue;
      }
      if (hasUser && hasGroup) {
        push(row.rowNo, {
          column: 'memberGroup',
          code: 'exactlyOne',
          params: { names: ['user', 'memberGroup'] },
          severity: 'error',
        });
        continue;
      }
      const member = memberOf(row.values);
      const groupId = typeof row.values.group === 'string' ? row.values.group : null;
      if (!member || !groupId) continue;
      if (member.type === 'group' && member.id === groupId) {
        push(row.rowNo, { column: 'memberGroup', code: 'membershipCycle', severity: 'error' });
        continue;
      }
      pending.push({ row, groupId, member });
    }
    if (!pending.length) return issues;

    const existing = await this.repo.findExistingMemberships(pending);
    const own = await this.ownGroups(ctx.actor);
    const blockedGroups = await this.notJoinable(ctx.actor, [
      ...new Set(pending.map((item) => item.groupId)),
    ]);
    const superAdmins = await this.superAdminUsers(
      ctx.actor,
      pending.flatMap((item) => (item.member.type === 'user' ? [item.member.id] : [])),
    );
    for (const { row, groupId, member } of pending) {
      const column = member.type === 'user' ? 'user' : 'memberGroup';
      if (existing.has(`${groupId}:${member.type}:${member.id}`)) {
        push(row.rowNo, {
          column,
          code: 'alreadyExists',
          params: { value: String(row.values[column] ?? '') },
          severity: 'error',
        });
      } else if (
        (member.type === 'user' && member.id === ctx.actor.id) ||
        (member.type === 'group' && own.has(member.id))
      ) {
        push(row.rowNo, { column, code: 'selfModify', severity: 'error' });
      } else if (blockedGroups.has(groupId) || superAdmins.has(member.id)) {
        push(row.rowNo, { column: 'group', code: 'escalation', severity: 'error' });
      }
    }
    return issues;
  }

  /** 這些角色中 actor 不能指派的（反提權）。 */
  private async notAssignable(actor: AuthUser, roleIds: readonly string[]): Promise<Set<string>> {
    const denied = new Set<string>();
    for (const id of roleIds) {
      try {
        await this.permissions.assertRolesAssignable(actor.id, [id]);
      } catch (error) {
        if (!(error instanceof AppException)) throw error;
        denied.add(id);
      }
    }
    return denied;
  }

  /** 這些群組中 actor 不能把人加進去的：成員會取得的權限 actor 沒有（D11）。 */
  private async notJoinable(actor: AuthUser, groupIds: readonly string[]): Promise<Set<string>> {
    const denied = new Set<string>();
    for (const id of groupIds) {
      try {
        await this.permissions.assertCanGrant(actor.id, [
          { object: { type: GROUP_OBJECT_TYPE, id }, relation: GROUP_MEMBER_RELATION },
        ]);
      } catch (error) {
        if (!(error instanceof AppException)) throw error;
        denied.add(id);
      }
    }
    return denied;
  }

  /** 只有 super-admin 能改 super-admin 的群組成員資格：actor 不是 super-admin 時，這些人裡的 super-admin。 */
  private async superAdminUsers(actor: AuthUser, userIds: readonly string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    if ((await this.permissions.getPermissionSet(actor.id)).isSuperAdmin) return new Set();
    const sets = await this.permissions.getPermissionSets([...new Set(userIds)]);
    return new Set(userIds.filter((id) => sets.get(id)?.isSuperAdmin));
  }

  /** actor 所屬（直接或經由巢狀）的群組 id：主體閉包裡的 `group:<id>#member`。 */
  private async ownGroups(actor: AuthUser): Promise<Set<string>> {
    const { subjects = [] } = await this.permissions.getPermissionSet(actor.id);
    return new Set(
      subjects.flatMap((key) => {
        const { object, relation } = parseSubjectKey(key);
        return object.type === GROUP_OBJECT_TYPE && relation === GROUP_MEMBER_RELATION
          ? [object.id]
          : [];
      }),
    );
  }
}

function memberOf(values: Readonly<Record<string, unknown>>): GroupMemberSubject | null {
  if (typeof values.user === 'string') return { type: 'user', id: values.user };
  if (typeof values.memberGroup === 'string') return { type: 'group', id: values.memberGroup };
  return null;
}

function toOptions(rows: ReadonlyArray<{ id: string; name: string }>) {
  return rows.map((row) => ({ id: row.id, label: row.name }));
}

function toGroupScope(scope: ExportScope<GroupExportFilter>) {
  return scope.kind === 'ids' ? { ids: scope.ids } : { filter: scope.filter };
}

function toMemberScope(scope: ExportScope<GroupMemberExportFilter>) {
  if (scope.kind === 'ids') return { groupIds: scope.ids };
  return scope.filter.groupId ? { groupIds: [scope.filter.groupId] } : {};
}

/** `GroupService` 的交易後副作用 → 框架可合併的副作用（權限失效只做一次、推播合併）。 */
function toEffects(after: GroupAfterCommit): AfterCommitEffect[] {
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
