import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import {
  GROUP_MAX_NESTING_DEPTH,
  GROUP_MEMBER_RELATION,
  GROUP_OBJECT_TYPE,
  subjectKey,
} from '@/core/authz';
import type { Database, DbOrTx, MissedUpdateCodes } from '@/core/database';
import { missedUpdate, TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import { RESOURCE_TYPE } from '@/core/resource';
import type { GroupMemberSubject, GroupRow } from '@/db/schema';
import { AnnouncementTriggerService } from '@/modules/announcement/announcement-trigger.service';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import { PermissionService } from '@/modules/permission/permission.service';

import type { CreateGroupDto } from './dto/create-group.dto';
import type { GroupDto, GroupRolesDto } from './dto/group.dto';
import type { ListGroupDto, ListGroupMembersDto } from './dto/list-group.dto';
import type {
  GroupMemberRef,
  UpdateGroupDto,
  UpdateGroupMembersDto,
  UpdateGroupRolesDto,
} from './dto/update-group.dto';
import { GROUP_MEMBER_ADDED_TRIGGER } from './group.announcement-triggers';
import { GROUP_AUDIT_FIELDS } from './group.constants';
import type { GroupWithCounts } from './group.repository';
import { GroupRepository } from './group.repository';

function toDto(group: GroupWithCounts): GroupDto {
  return {
    ...(group.membership && { membership: group.membership }),
    id: group.id,
    name: group.name,
    description: group.description,
    memberCount: group.memberCount,
    roleCount: group.roleCount,
    version: group.version,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

/** 同一個成員只留一次（`add`、`remove` 各自去重）。 */
function uniqueMembers(members: readonly GroupMemberRef[]): GroupMemberSubject[] {
  const seen = new Map<string, GroupMemberSubject>();
  for (const member of members) seen.set(`${member.type}:${member.id}`, member);
  return [...seen.values()];
}

function idsOf(members: readonly GroupMemberSubject[], type: GroupMemberSubject['type']): string[] {
  return members.filter((member) => member.type === type).map((member) => member.id);
}

/**
 * 群組（docs/rbac/01-domain-model.md §9.3 D11～D13、D16）。
 *
 * 群組是純分組：成員與持有的角色都是 `relation_tuples` 的邊，權限由關係圖解析（巢狀、持有的角色都在主體閉包裡）。
 * 會改變誰有什麼權限的寫入（成員、持有的角色、刪除、還原）都在交易後 `permissionsChanged()`。
 *
 * 反提權（都經 `PermissionService.assertCanGrant`，由引擎展開「取得了什麼」）：
 * - 把人（或群組）放進 G ＝ 成為 `group:G#member`，取得 G **與它所有上層群組** 持有的角色（D11）。
 * - 讓 G 持有角色 ＝ 把角色指派給 G 的所有成員 → `assertRolesAssignable`；super-admin 一律拒絕（D12）。
 * - 只檢查全域權限鍵，不檢查群組在資料夾上的授權（D13）。
 * - 不能改自己：把自己、自己所屬的群組放進或移出群組，或改自己所屬群組持有的角色（I9 的延伸）。
 */
/** 樂觀鎖的條件式 UPDATE 沒命中時的錯誤碼（`missedUpdate`）。 */
const GROUP_LOCK_CODES = {
  notFound: 'GROUP_NOT_FOUND',
  conflict: 'GROUP_VERSION_CONFLICT',
} as const satisfies MissedUpdateCodes;

@Injectable()
export class GroupService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: GroupRepository,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly announcementTriggers: AnnouncementTriggerService,
  ) {}

  async list(query: ListGroupDto) {
    const { items, total } = await this.repo.list(query);
    return paginated(items.map(toDto), total, query);
  }

  async findOne(id: string): Promise<GroupDto> {
    const group = await this.repo.withCounts(id);
    if (!group) throw new AppException('GROUP_NOT_FOUND');
    return toDto(group);
  }

  async listMembers(id: string, query: ListGroupMembersDto) {
    await this.getExisting(id);
    const { items, total } = await this.repo.listMembers(id, query.offset, query.limit);
    return paginated(items, total, query);
  }

  async listRoles(id: string): Promise<GroupRolesDto> {
    await this.getExisting(id);
    return { roles: await this.repo.listRoles(id) };
  }

  async create(dto: CreateGroupDto, actor: AuthUser): Promise<GroupDto> {
    await this.assertNameAvailable(dto.name);
    const group = await withTransaction(this.db, async (tx) => {
      const created = await this.repo.create(
        {
          name: dto.name,
          description: dto.description ?? null,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'group.create',
          resourceType: RESOURCE_TYPE.GROUP,
          resourceId: created.id,
          resourceName: created.name,
          changes: { after: { name: created.name, description: created.description } },
        },
        tx,
      );
      return created;
    });

    this.publish(ChangeKind.CREATE, group.id);
    return this.findOne(group.id);
  }

  async update(id: string, dto: UpdateGroupDto, actor: AuthUser): Promise<GroupDto> {
    const { version, ...fields } = dto;
    const group = await this.getExisting(id);
    if (version !== group.version) {
      throw new AppException('GROUP_VERSION_CONFLICT', { current: group.version });
    }
    // 只改大小寫不算撞名：唯一性不分大小寫，撞到的是自己
    if (dto.name && dto.name.toLowerCase() !== group.name.toLowerCase()) {
      await this.assertNameAvailable(dto.name);
    }
    const changes = diff(group, fields, [...GROUP_AUDIT_FIELDS]);

    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(id, { ...fields, updatedBy: actor.id }, version, tx);
      if (!updated) throw await missedUpdate(() => this.repo.findVersion(id, tx), GROUP_LOCK_CODES);
      await this.audit.record(
        {
          action: 'group.update',
          resourceType: RESOURCE_TYPE.GROUP,
          resourceId: id,
          resourceName: updated.name,
          changes,
        },
        tx,
      );
    });

    // 改名不影響權限
    this.publish(ChangeKind.UPDATE, id);
    return this.findOne(id);
  }

  /**
   * 軟刪除。成員與持有角色的邊保留（休眠，還原時回來）；成員因此失去群組帶來的權限。
   * 成員在刪除前查出，只用來推播與補建個人資料夾。
   */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const group = await this.getExisting(id);
    const affected = await this.repo.memberUserIds(id);

    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.lockActiveRow(id, tx))) throw new AppException('GROUP_NOT_FOUND');
      await this.repo.softDelete(id, actor.id, tx);
      await this.audit.record(
        {
          action: 'group.delete',
          resourceType: RESOURCE_TYPE.GROUP,
          resourceId: id,
          resourceName: group.name,
          changes: { before: { name: group.name } },
          metadata: { affectedUserCount: affected.length },
        },
        tx,
      );
    });

    await this.permissionService.permissionsChanged(affected);
    this.publish(ChangeKind.DELETE, id, affected);
  }

  /**
   * 還原刪除的群組：清 `deleted_at`，保留的成員與持有角色的邊隨之生效。
   * 等於把 G 與它所有上層群組的角色重新交給 G 的成員，所以反提權與加成員相同（D11）。
   * 刪除期間結構可能被改過（例：G 的上層群組又被加進 G 底下），還原後的結構也要通過循環與層數的檢查。
   */
  async restore(id: string, actor: AuthUser): Promise<GroupDto> {
    const group = await this.repo.findDeletedById(id);
    if (!group) {
      throw new AppException(
        (await this.repo.exists(id)) ? 'GROUP_NOT_DELETED' : 'GROUP_NOT_FOUND',
      );
    }
    const nameTaken = await this.repo.findByName(group.name);
    if (nameTaken) {
      throw new AppException('GROUP_NAME_DUPLICATE', {
        field: 'name',
        value: group.name,
        conflictingGroupId: nameTaken.id,
      });
    }

    await withTransaction(this.db, async (tx) => {
      await this.repo.lockMembership(tx);
      const row = await this.repo.restore(id, actor.id, tx);
      // 檢查之後被別人搶先還原
      if (!row) throw new AppException('GROUP_NOT_DELETED');
      const [ancestors, descendants] = await Promise.all([
        this.repo.ancestors(id, tx),
        this.repo.descendants(id, tx),
      ]);
      this.assertAcyclic(ancestors, descendants);
      this.assertNestingDepth(ancestors, descendants);
      await this.assertCanJoin(actor, id, tx);
      await this.audit.record(
        {
          action: 'group.restore',
          resourceType: RESOURCE_TYPE.GROUP,
          resourceId: id,
          resourceName: row.name,
          changes: { after: { name: row.name } },
          metadata: { deletedAt: group.deletedAt?.toISOString() },
        },
        tx,
      );
    });

    const affected = await this.repo.memberUserIds(id);
    await this.permissionService.permissionsChanged(affected);
    // 重新出現在列表：以 create 宣告（與角色的還原相同）
    this.publish(ChangeKind.CREATE, id, affected);
    return this.findOne(id);
  }

  /** 增減直接成員（差異語意）。加入的成員取得 G 與它所有上層群組持有的角色（D11）。 */
  async updateMembers(id: string, dto: UpdateGroupMembersDto, actor: AuthUser): Promise<GroupDto> {
    const group = await this.getExisting(id);
    const add = uniqueMembers(dto.add);
    const remove = uniqueMembers(dto.remove);

    await this.assertMembersExist(add);
    await this.assertNotSelfMembership(actor, [...add, ...remove]);
    await this.assertCanManageUsers(actor, [...idsOf(add, 'user'), ...idsOf(remove, 'user')]);
    if (idsOf(add, 'group').includes(id)) throw new AppException('GROUP_MEMBERSHIP_CYCLE');

    const before = await this.repo.memberUserIds(id);
    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.lockActiveRow(id, tx))) throw new AppException('GROUP_NOT_FOUND');
      await this.repo.lockMembership(tx);
      const beforeRefs = await this.repo.listMemberRefs(id, tx);

      if (add.length) {
        const ancestors = await this.repo.ancestors(id, tx);
        const ancestorIds = new Set(ancestors.map((ancestor) => ancestor.id));
        for (const nested of idsOf(add, 'group')) {
          // H 已經（直接或間接）包含 G：把 H 放進 G 會形成循環
          if (ancestorIds.has(nested)) {
            throw new AppException('GROUP_MEMBERSHIP_CYCLE', { groupId: nested });
          }
          // oxlint-disable-next-line no-await-in-loop -- 一次加入的群組很少；在同一把鎖內依序檢查
          const below = await this.repo.descendants(nested, tx);
          this.assertNestingDepth(ancestors, below, 2);
        }
        await this.assertCanJoin(actor, id, tx);
      }

      await this.repo.removeMembers(id, remove, tx);
      await this.repo.addMembers(id, add, actor.id, tx);
      const afterRefs = await this.repo.listMemberRefs(id, tx);
      if (add.length) {
        await this.audit.record(
          {
            action: 'group.member.add',
            resourceType: RESOURCE_TYPE.GROUP,
            resourceId: id,
            resourceName: group.name,
            changes: { before: { members: beforeRefs }, after: { members: afterRefs } },
            metadata: { added: add },
          },
          tx,
        );
        await this.announcementTriggers.fire(
          GROUP_MEMBER_ADDED_TRIGGER,
          { userIds: idsOf(add, 'user'), groupId: id },
          tx,
        );
      }
      if (remove.length) {
        await this.audit.record(
          {
            action: 'group.member.remove',
            resourceType: RESOURCE_TYPE.GROUP,
            resourceId: id,
            resourceName: group.name,
            changes: { before: { members: beforeRefs }, after: { members: afterRefs } },
            metadata: { removed: remove },
          },
          tx,
        );
      }
    });

    // 加入與移出的人（含巢狀群組底下的人）都受影響：前後的聯集
    const after = await this.repo.memberUserIds(id);
    const affected = [...new Set([...before, ...after])];
    await this.permissionService.permissionsChanged(affected);
    this.publish(ChangeKind.UPDATE, id, affected);
    return this.findOne(id);
  }

  /** 增減群組持有的角色（差異語意）。等於把角色指派給群組的所有成員（D12：不能是 super-admin）。 */
  async updateRoles(id: string, dto: UpdateGroupRolesDto, actor: AuthUser): Promise<GroupRolesDto> {
    const group = await this.getExisting(id);
    const add = [...new Set(dto.add)];
    const remove = [...new Set(dto.remove)];

    await this.assertNotSelfMembership(actor, [{ type: 'group', id }]);
    const found = await this.repo.findActiveRoles(add);
    const missing = add.filter((roleId) => !found.some((role) => role.id === roleId));
    if (missing.length) throw new AppException('ROLE_NOT_FOUND', { ids: missing });
    if (found.some((role) => role.slug === SUPER_ADMIN_SLUG)) {
      throw new AppException('GROUP_SUPER_ADMIN_FORBIDDEN');
    }
    await this.permissionService.assertRolesAssignable(actor.id, add);

    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.lockActiveRow(id, tx))) throw new AppException('GROUP_NOT_FOUND');
      const before = await this.repo.listRoleIds(id, tx);
      await this.repo.removeRoles(id, remove, tx);
      await this.repo.addRoles(id, add, actor.id, tx);
      const after = await this.repo.listRoleIds(id, tx);
      await this.audit.record(
        {
          action: 'group.assignRole',
          resourceType: RESOURCE_TYPE.GROUP,
          resourceId: id,
          resourceName: group.name,
          changes: { before: { roles: before }, after: { roles: after } },
        },
        tx,
      );
    });

    const affected = await this.repo.memberUserIds(id);
    await this.permissionService.permissionsChanged(affected);
    this.publish(ChangeKind.UPDATE, id, affected);
    return { roles: await this.repo.listRoles(id) };
  }

  // ── 業務規則 ─────────────────────────────────────────────

  /**
   * 把人放進 G（或還原 G）＝ 讓他成為 `group:G#member`：引擎沿成員關係往上展開（上層群組、它們持有的角色），
   * 帶來的租戶能力都要是操作者持有的（D11）。在交易內、成員的鎖之後呼叫，看到的是一致的結構。
   */
  private async assertCanJoin(actor: AuthUser, groupId: string, tx: DbOrTx): Promise<void> {
    await this.permissionService.assertCanGrant(
      actor.id,
      [{ object: { type: GROUP_OBJECT_TYPE, id: groupId }, relation: GROUP_MEMBER_RELATION }],
      tx,
    );
  }

  /**
   * 放進或移出的成員（或被改角色的群組）不能是操作者自己、也不能是操作者所屬（直接或間接）的群組：
   * 等於改自己的角色（docs/rbac/01-domain-model.md I9 的延伸）。所屬的群組取自操作者的主體閉包。
   */
  private async assertNotSelfMembership(
    actor: AuthUser,
    members: readonly GroupMemberSubject[],
  ): Promise<void> {
    if (members.some((member) => member.type === 'user' && member.id === actor.id)) {
      throw new AppException('AUTHZ_SELF_MODIFY');
    }
    const groupIds = idsOf(members, 'group');
    if (!groupIds.length) return;
    const { subjects = [] } = await this.permissionService.getPermissionSet(actor.id);
    const own = new Set(subjects);
    if (groupIds.some((id) => own.has(subjectKey(GROUP_OBJECT_TYPE, id, GROUP_MEMBER_RELATION)))) {
      throw new AppException('AUTHZ_SELF_MODIFY');
    }
  }

  /** 只有 super-admin 能改 super-admin 的群組成員資格（比照 `UserService.assertCanManage`）。 */
  private async assertCanManageUsers(actor: AuthUser, userIds: readonly string[]): Promise<void> {
    if (!userIds.length) return;
    const actorSet = await this.permissionService.getPermissionSet(actor.id);
    if (actorSet.isSuperAdmin) return;
    const sets = await this.permissionService.getPermissionSets(userIds);
    const target = userIds.find((userId) => sets.get(userId)?.isSuperAdmin);
    if (target) {
      throw new AppException('AUTHZ_ESCALATION', { role: SUPER_ADMIN_SLUG, target });
    }
  }

  private async assertMembersExist(add: readonly GroupMemberSubject[]): Promise<void> {
    const userIds = idsOf(add, 'user');
    const groupIds = idsOf(add, 'group');
    const [users, groups] = await Promise.all([
      this.repo.findActiveUserIds(userIds),
      this.repo.findActiveGroupIds(groupIds),
    ]);
    const missingUsers = userIds.filter((id) => !users.includes(id));
    if (missingUsers.length) throw new AppException('USER_NOT_FOUND', { ids: missingUsers });
    const missingGroups = groupIds.filter((id) => !groups.includes(id));
    if (missingGroups.length) throw new AppException('GROUP_NOT_FOUND', { ids: missingGroups });
  }

  /** 一個上層群組同時也在底下：結構有循環（只會在還原時出現，加成員時已先擋）。 */
  private assertAcyclic(
    ancestors: ReadonlyArray<{ id: string }>,
    descendants: ReadonlyArray<{ id: string }>,
  ): void {
    const above = new Set(ancestors.map((ancestor) => ancestor.id));
    const loop = descendants.find((descendant) => above.has(descendant.id));
    if (loop) throw new AppException('GROUP_MEMBERSHIP_CYCLE', { groupId: loop.id });
  }

  /**
   * 經過這裡的最長一條「群組在群組裡」的鏈不能超過 `GROUP_MAX_NESTING_DEPTH`（否則主體閉包走不到，權限會靜靜地消失）。
   * `levels` 是這條鏈在上下兩段之外有幾個群組：還原時只有 G 自己（1），加入 H 時是 G 與 H（2）。
   */
  private assertNestingDepth(
    above: ReadonlyArray<{ depth: number }>,
    below: ReadonlyArray<{ depth: number }>,
    levels = 1,
  ): void {
    const up = Math.max(0, ...above.map((row) => row.depth));
    const down = Math.max(0, ...below.map((row) => row.depth));
    if (up + down + levels > GROUP_MAX_NESTING_DEPTH) {
      throw new AppException('GROUP_NESTING_TOO_DEEP', { max: GROUP_MAX_NESTING_DEPTH });
    }
  }

  private publish(kind: ChangeKind, id: string, affectedUserIds: readonly string[] = []): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.GROUP, kind, id }],
      affectedUserIds: [...affectedUserIds],
    });
  }

  private async getExisting(id: string): Promise<GroupRow> {
    const group = await this.repo.findById(id);
    if (!group) throw new AppException('GROUP_NOT_FOUND');
    return group;
  }

  private async assertNameAvailable(name: string): Promise<void> {
    if (await this.repo.findByName(name)) {
      throw new AppException('GROUP_NAME_DUPLICATE', { field: 'name', value: name });
    }
  }
}
