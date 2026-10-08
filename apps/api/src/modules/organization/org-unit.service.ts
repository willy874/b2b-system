import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, DbOrTx, MissedUpdateCodes } from '@/core/database';
import { missedUpdate, TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import { RESOURCE_TYPE } from '@/core/resource';
import type { OrgUnitRow } from '@/db/schema';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';

import type {
  CreateOrgUnitDto,
  ListOrgUnitDto,
  ListOrgUnitMembersDto,
  MoveOrgUnitDto,
  OrgUnitDetailDto,
  OrgUnitDto,
  UpdateOrgUnitDto,
  UpdateOrgUnitMembersDto,
  UserOrgUnitDto,
} from './dto/org-unit.dto';
import type { OrgUnitWithCounts } from './org-unit.repository';
import { OrgUnitRepository } from './org-unit.repository';
import { ORG_UNIT_AUDIT_FIELDS, ORG_UNIT_MAX_DEPTH } from './organization.constants';

function toDto(unit: OrgUnitWithCounts): OrgUnitDto {
  return {
    id: unit.id,
    parentId: unit.parentId,
    name: unit.name,
    code: unit.code,
    description: unit.description,
    sortOrder: unit.sortOrder,
    memberCount: unit.memberCount,
    managerCount: unit.managerCount,
    version: unit.version,
    createdAt: unit.createdAt.toISOString(),
    updatedAt: unit.updatedAt.toISOString(),
  };
}

/** 樂觀鎖的條件式 UPDATE 沒命中時的錯誤碼（`missedUpdate`）。 */
const ORG_UNIT_LOCK_CODES = {
  notFound: 'ORG_UNIT_NOT_FOUND',
  conflict: 'ORG_UNIT_VERSION_CONFLICT',
} as const satisfies MissedUpdateCodes;

/**
 * 組織的部門與成員（docs/architecture/backend/23-organization.md）。
 *
 * 部門不是授權來源（D1）：成員與主管的寫入不碰 `relation_tuples`，也不必 `permissionsChanged()`。
 * 但「誰是誰的主管」決定審批的審核資格，所以不能改自己的成員資格與主管身分（D6）。
 */
@Injectable()
export class OrgUnitService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: OrgUnitRepository,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  /** 整棵樹；有關鍵字時只回符合的部門與它們的上層（樹才接得起來）。 */
  async list(query: ListOrgUnitDto): Promise<{ items: OrgUnitDto[] }> {
    const units = await this.repo.listAll();
    if (!query.keyword) return { items: units.map(toDto) };

    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const keep = new Set<string>();
    for (const id of await this.repo.matchKeyword(query.keyword)) {
      let current = byId.get(id);
      while (current && !keep.has(current.id)) {
        keep.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return { items: units.filter((unit) => keep.has(unit.id)).map(toDto) };
  }

  async findOne(id: string): Promise<OrgUnitDetailDto> {
    const unit = await this.repo.withCounts(id);
    if (!unit) throw new AppException('ORG_UNIT_NOT_FOUND');
    const paths = await this.repo.pathsOf([id]);
    return { ...toDto(unit), path: paths.get(id) ?? [] };
  }

  async create(dto: CreateOrgUnitDto, actor: AuthUser): Promise<OrgUnitDetailDto> {
    const parentId = dto.parentId ?? null;
    const code = dto.code ?? null;
    if (code) await this.assertCodeAvailable(code);

    const unit = await withTransaction(this.db, async (tx) => {
      await this.repo.lockStructure(tx);
      if (parentId) {
        if (!(await this.repo.findById(parentId, tx))) throw new AppException('ORG_UNIT_NOT_FOUND');
        // 新部門的層數 = 上層的層數 ＋ 1
        await this.assertDepth(parentId, 0, tx);
      }
      await this.assertNameAvailable(parentId, dto.name, undefined, tx);
      const created = await this.repo.create(
        {
          parentId,
          name: dto.name,
          code,
          description: dto.description ?? null,
          sortOrder: await this.repo.nextSortOrder(parentId, tx),
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'orgUnit.create',
          resourceType: RESOURCE_TYPE.ORG_UNIT,
          resourceId: created.id,
          resourceName: created.name,
          changes: {
            after: {
              name: created.name,
              parentId: created.parentId,
              code: created.code,
              description: created.description,
            },
          },
        },
        tx,
      );
      return created;
    });

    this.publish(ChangeKind.CREATE, unit.id);
    return this.findOne(unit.id);
  }

  async update(id: string, dto: UpdateOrgUnitDto, actor: AuthUser): Promise<OrgUnitDetailDto> {
    const { version, ...fields } = dto;
    const unit = await this.getExisting(id);
    if (version !== unit.version) {
      throw new AppException('ORG_UNIT_VERSION_CONFLICT', { current: unit.version });
    }
    if (fields.code) await this.assertCodeAvailable(fields.code, id);
    const changes = diff(unit, fields, [...ORG_UNIT_AUDIT_FIELDS]);

    await withTransaction(this.db, async (tx) => {
      // 改名的撞名檢查要在結構的鎖之內：同時有人把別的部門搬進同一個上層
      await this.repo.lockStructure(tx);
      if (fields.name) await this.assertNameAvailable(unit.parentId, fields.name, id, tx);
      const updated = await this.repo.update(id, { ...fields, updatedBy: actor.id }, version, tx);
      if (!updated) {
        throw await missedUpdate(() => this.repo.findVersion(id, tx), ORG_UNIT_LOCK_CODES);
      }
      await this.audit.record(
        {
          action: 'orgUnit.update',
          resourceType: RESOURCE_TYPE.ORG_UNIT,
          resourceId: id,
          resourceName: updated.name,
          changes,
        },
        tx,
      );
    });

    this.publish(ChangeKind.UPDATE, id);
    return this.findOne(id);
  }

  /**
   * 換上層與同層的排序（TreeEditor 的拖放）。擋循環（搬到自己或自己的下層之下）與層數上限；
   * 新的上層之下不能有同名的部門。
   */
  async move(id: string, dto: MoveOrgUnitDto, actor: AuthUser): Promise<OrgUnitDetailDto> {
    const unit = await this.getExisting(id);
    if (dto.version !== unit.version) {
      throw new AppException('ORG_UNIT_VERSION_CONFLICT', { current: unit.version });
    }
    const parentId = dto.parentId;
    if (parentId === id) throw new AppException('ORG_UNIT_CYCLE');

    await withTransaction(this.db, async (tx) => {
      await this.repo.lockStructure(tx);
      const subtree = await this.repo.descendants(id, tx);
      if (parentId) {
        if (!(await this.repo.findById(parentId, tx))) throw new AppException('ORG_UNIT_NOT_FOUND');
        if (subtree.some((row) => row.id === parentId)) throw new AppException('ORG_UNIT_CYCLE');
        const height = Math.max(0, ...subtree.map((row) => row.depth));
        await this.assertDepth(parentId, height, tx);
      }
      if (parentId !== unit.parentId) {
        await this.assertNameAvailable(parentId, unit.name, id, tx);
      }

      const updated = await this.repo.update(
        id,
        { parentId, updatedBy: actor.id },
        dto.version,
        tx,
      );
      if (!updated) {
        throw await missedUpdate(() => this.repo.findVersion(id, tx), ORG_UNIT_LOCK_CODES);
      }
      const siblings = (await this.repo.listSiblings(parentId, tx)).filter((row) => row.id !== id);
      const order = siblings.map((row) => row.id);
      const at = dto.beforeId ? order.indexOf(dto.beforeId) : -1;
      order.splice(at >= 0 ? at : order.length, 0, id);
      await this.repo.setSortOrders(order, tx);

      await this.audit.record(
        {
          action: 'orgUnit.move',
          resourceType: RESOURCE_TYPE.ORG_UNIT,
          resourceId: id,
          resourceName: unit.name,
          changes: {
            before: { parentId: unit.parentId },
            after: { parentId },
          },
          metadata: { beforeId: dto.beforeId ?? null },
        },
        tx,
      );
    });

    this.publish(ChangeKind.UPDATE, id);
    return this.findOne(id);
  }

  /**
   * 軟刪除。還有下層部門時不能刪（`409 ORG_UNIT_HAS_CHILDREN`）；成員資格保留（休眠），還原時回來。
   */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const unit = await this.getExisting(id);
    const affected = await this.repo.memberUserIds(id);

    await withTransaction(this.db, async (tx) => {
      await this.repo.lockStructure(tx);
      if (!(await this.repo.lockActiveRow(id, tx))) throw new AppException('ORG_UNIT_NOT_FOUND');
      if (await this.repo.hasActiveChildren(id, tx))
        throw new AppException('ORG_UNIT_HAS_CHILDREN');
      await this.repo.softDelete(id, actor.id, tx);
      await this.audit.record(
        {
          action: 'orgUnit.delete',
          resourceType: RESOURCE_TYPE.ORG_UNIT,
          resourceId: id,
          resourceName: unit.name,
          changes: { before: { name: unit.name, parentId: unit.parentId } },
          metadata: { affectedUserCount: affected.length },
        },
        tx,
      );
    });

    this.publish(ChangeKind.DELETE, id, affected);
  }

  /** 還原：上層必須未刪除（先還原上層）；名稱、代碼不能與現有的部門衝突。 */
  async restore(id: string, actor: AuthUser): Promise<OrgUnitDetailDto> {
    const unit = await this.repo.findDeletedById(id);
    if (!unit) {
      throw new AppException(
        (await this.repo.exists(id)) ? 'ORG_UNIT_NOT_DELETED' : 'ORG_UNIT_NOT_FOUND',
      );
    }
    if (unit.code) {
      const taken = await this.repo.findByCode(unit.code);
      if (taken) {
        throw new AppException('ORG_UNIT_CODE_DUPLICATE', {
          field: 'code',
          value: unit.code,
          conflictingUnitId: taken.id,
        });
      }
    }

    await withTransaction(this.db, async (tx) => {
      await this.repo.lockStructure(tx);
      if (unit.parentId && !(await this.repo.findById(unit.parentId, tx))) {
        throw new AppException('ORG_UNIT_PARENT_DELETED', { parentId: unit.parentId });
      }
      await this.assertNameAvailable(unit.parentId, unit.name, id, tx);
      const row = await this.repo.restore(id, actor.id, tx);
      // 檢查之後被別人搶先還原
      if (!row) throw new AppException('ORG_UNIT_NOT_DELETED');
      await this.audit.record(
        {
          action: 'orgUnit.restore',
          resourceType: RESOURCE_TYPE.ORG_UNIT,
          resourceId: id,
          resourceName: row.name,
          changes: { after: { name: row.name, parentId: row.parentId } },
          metadata: { deletedAt: unit.deletedAt?.toISOString() },
        },
        tx,
      );
    });

    const affected = await this.repo.memberUserIds(id);
    // 重新出現在樹上：以 create 宣告（與群組的還原相同）
    this.publish(ChangeKind.CREATE, id, affected);
    return this.findOne(id);
  }

  async listMembers(id: string, query: ListOrgUnitMembersDto) {
    await this.getExisting(id);
    const unitIds = query.includeDescendants
      ? (await this.repo.descendants(id)).map((row) => row.id)
      : [id];
    const { items, total } = await this.repo.listMembers(unitIds, query);
    return paginated(items, total, query);
  }

  /**
   * 增減、修改成員（差異語意）。設為主要部門時，那個人原本的主要部門在同一個交易內取消。
   * 不能改自己（D6）：主管身分決定審批的審核資格，搬動自己也會改變自己的主管是誰。
   */
  async updateMembers(
    id: string,
    dto: UpdateOrgUnitMembersDto,
    actor: AuthUser,
  ): Promise<OrgUnitDetailDto> {
    const unit = await this.getExisting(id);
    const touched = [
      ...dto.add.map((member) => member.userId),
      ...dto.update.map((member) => member.userId),
      ...dto.remove,
    ];
    if (touched.includes(actor.id)) throw new AppException('AUTHZ_SELF_MODIFY');
    const joining = [...dto.add, ...dto.update].map((member) => member.userId);
    const found = await this.repo.findActiveUserIds(joining);
    const missing = joining.filter((userId) => !found.includes(userId));
    if (missing.length) throw new AppException('USER_NOT_FOUND', { ids: missing });

    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.lockActiveRow(id, tx))) throw new AppException('ORG_UNIT_NOT_FOUND');
      const before = await this.repo.memberSnapshot(id, tx);
      await this.repo.removeMembers(id, dto.remove, tx);
      const upserts = [...dto.add, ...dto.update];
      await this.repo.clearPrimaryElsewhere(
        id,
        upserts.filter((member) => member.isPrimary).map((member) => member.userId),
        tx,
      );
      await this.repo.upsertMembers(id, upserts, actor.id, tx);
      const after = await this.repo.memberSnapshot(id, tx);

      const record = (action: string, metadata: Record<string, unknown>) =>
        this.audit.record(
          {
            action,
            resourceType: RESOURCE_TYPE.ORG_UNIT,
            resourceId: id,
            resourceName: unit.name,
            changes: { before: { members: before }, after: { members: after } },
            metadata,
          },
          tx,
        );
      if (dto.add.length) await record('orgUnit.member.add', { added: dto.add });
      if (dto.update.length) await record('orgUnit.member.update', { updated: dto.update });
      if (dto.remove.length) await record('orgUnit.member.remove', { removed: dto.remove });
    });

    this.publish(ChangeKind.UPDATE, id, touched);
    return this.findOne(id);
  }

  /** 那個人所屬的部門（主要部門在前），每一列帶上層路徑。 */
  async unitsOfUser(userId: string): Promise<{ items: UserOrgUnitDto[] }> {
    const rows = await this.repo.unitsOfUser(userId);
    const paths = await this.repo.pathsOf(rows.map((row) => row.unitId));
    return {
      items: rows.map((row) => ({ ...row, path: paths.get(row.unitId) ?? [] })),
    };
  }

  // ── 業務規則 ─────────────────────────────────────────────

  /**
   * 把高度為 `height`（0 = 只有自己）的子樹放到 `parentId` 之下後，最深的一層不能超過 `ORG_UNIT_MAX_DEPTH`。
   * 上層本身的層數 = 它的上層數 ＋ 1。
   */
  private async assertDepth(parentId: string, height: number, tx: DbOrTx): Promise<void> {
    const parentDepth = (await this.repo.ancestors(parentId, tx)).length + 1;
    if (parentDepth + 1 + height > ORG_UNIT_MAX_DEPTH) {
      throw new AppException('ORG_UNIT_TOO_DEEP', { max: ORG_UNIT_MAX_DEPTH });
    }
  }

  private async assertNameAvailable(
    parentId: string | null,
    name: string,
    excludeId: string | undefined,
    tx: DbOrTx,
  ): Promise<void> {
    const taken = await this.repo.findSiblingByName(parentId, name, excludeId, tx);
    if (taken) {
      throw new AppException('ORG_UNIT_NAME_DUPLICATE', {
        field: 'name',
        value: name,
        conflictingUnitId: taken.id,
      });
    }
  }

  private async assertCodeAvailable(code: string, excludeId?: string): Promise<void> {
    const taken = await this.repo.findByCode(code, excludeId);
    if (taken) {
      throw new AppException('ORG_UNIT_CODE_DUPLICATE', {
        field: 'code',
        value: code,
        conflictingUnitId: taken.id,
      });
    }
  }

  private async getExisting(id: string): Promise<OrgUnitRow> {
    const unit = await this.repo.findById(id);
    if (!unit) throw new AppException('ORG_UNIT_NOT_FOUND');
    return unit;
  }

  private publish(kind: ChangeKind, id: string, affectedUserIds: readonly string[] = []): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.ORG_UNIT, kind, id }],
      affectedUserIds: [...affectedUserIds],
    });
  }
}
