import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import type { FileFolderRow, GrantLevel, ResourceGrantInsert } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import {
  inheritanceChain,
  levelRank,
  maxLevel,
} from '@/modules/resource-grant/resource-grant.resolver';
import { ResourceGrantService } from '@/modules/resource-grant/resource-grant.service';
import type { GrantKey } from '@/modules/resource-grant/resource-grant.service';

import type {
  FileFolderGrantDto,
  FileFolderGrantListDto,
  FileGrantSubjectListDto,
  FileGrantSubjectType,
  ListFileGrantSubjectsDto,
  SetFileFolderGrantDto,
  UpdateFileFolderAccessDto,
} from './dto/file-folder-grant.dto';
import { FILE_ACTION_PERMISSION } from './file-access.context';
import type { FileAccessContext } from './file-access.context';
import { FileAccessService } from './file-access.service';
import { FileFolderRepository } from './file-folder.repository';

/** 授權對象候選清單一次最多幾筆（挑選用，不分頁）。 */
const SUBJECT_SEARCH_LIMIT = 20;

/**
 * 資料夾授權的管理（docs/rbac/07-resource-grants.md §6）：清單、新增／變更、移除、候選對象。
 * 需要在該資料夾 `share`；授予或移除的等級受反提權限制（§6.1）。
 * 寫入與稽核在同一個交易、交易後推 `fileFolder update`（能力旗標跟著變）。
 */
@Injectable()
export class FileFolderGrantService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly folders: FileFolderRepository,
    private readonly grants: ResourceGrantService,
    private readonly access: FileAccessService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  /** 直接授權 ＋ 從上層繼承來的授權（標出來源資料夾）。 */
  async list(folderId: string, actor: AuthUser): Promise<FileFolderGrantListDto> {
    const ctx = await this.access.contextFor(actor);
    await this.assertCanShare(ctx, actor, folderId);
    return this.buildList(ctx, folderId);
  }

  async set(
    folderId: string,
    dto: SetFileFolderGrantDto,
    actor: AuthUser,
  ): Promise<FileFolderGrantListDto> {
    await this.writeGrants(async (tx) => {
      const ctx = await this.access.contextFor(actor, tx);
      const folder = await this.assertCanShare(ctx, actor, folderId, tx);
      if (!(await this.grants.subjectExists(dto.subjectType, dto.subjectId, tx))) {
        throw new AppException('FILE_GRANT_SUBJECT_NOT_FOUND', {
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
        });
      }
      const key = this.keyOf(folderId, dto.subjectType, dto.subjectId);
      const before = await this.grants.find(key, tx);
      // 變更既有的授權也要「管得了」原本的等級：不能把比自己高的人降級
      this.assertGrantable(ctx, folderId, before ? [before.level, dto.level] : [dto.level]);

      const after = await this.grants.set(
        key,
        {
          level: dto.level,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          grantedBy: actor.id,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'fileFolder.grant',
          resourceType: 'fileFolder',
          resourceId: folderId,
          resourceName: folder.name,
          changes: {
            before: before ? snapshot(before) : null,
            after: snapshot(after),
          },
        },
        tx,
      );
    });
    this.publish(folderId);
    // 授權變了，操作者的能力也可能變（例：授予自己的角色）：以寫入後的狀態重新解析
    return this.buildList(await this.access.contextFor(actor), folderId);
  }

  async revoke(
    folderId: string,
    subjectType: FileGrantSubjectType,
    subjectId: string,
    actor: AuthUser,
  ): Promise<void> {
    await this.writeGrants(async (tx) => {
      const ctx = await this.access.contextFor(actor, tx);
      const folder = await this.assertCanShare(ctx, actor, folderId, tx);
      const key = this.keyOf(folderId, subjectType, subjectId);
      const existing = await this.grants.find(key, tx);
      if (!existing) throw new AppException('FILE_GRANT_NOT_FOUND', { subjectType, subjectId });
      this.assertGrantable(ctx, folderId, [existing.level]);

      await this.grants.revoke(key, tx);
      await this.audit.record(
        {
          action: 'fileFolder.revoke',
          resourceType: 'fileFolder',
          resourceId: folderId,
          resourceName: folder.name,
          changes: { before: snapshot(existing) },
        },
        tx,
      );
    });
    this.publish(folderId);
  }

  /**
   * 中斷／恢復繼承（§3.3）。中斷時把目前繼承到的授權（上層鏈上、到上一個中斷點為止）複製成
   * 這個資料夾的直接授權，同一個對象取較高的等級：中斷當下沒有人失去存取，之後再由管理者移除。
   * 複製不是授予新的存取，不受反提權限制。
   */
  async setInheritance(
    folderId: string,
    dto: UpdateFileFolderAccessDto,
    actor: AuthUser,
  ): Promise<FileFolderGrantListDto> {
    await this.writeGrants(async (tx) => {
      const ctx = await this.access.contextFor(actor, tx);
      const folder = await this.assertCanShare(ctx, actor, folderId, tx);
      if (folder.inheritGrants === dto.inheritGrants) return;

      const copied = dto.inheritGrants ? [] : await this.copyInherited(ctx, folderId, actor, tx);
      await this.folders.setInheritGrants(
        folderId,
        { inheritGrants: dto.inheritGrants, updatedBy: actor.id },
        tx,
      );
      await this.audit.record(
        {
          action: 'fileFolder.inheritance',
          resourceType: 'fileFolder',
          resourceId: folderId,
          resourceName: folder.name,
          changes: {
            before: { inheritGrants: folder.inheritGrants },
            after: { inheritGrants: dto.inheritGrants, copied: copied.map(snapshot) },
          },
        },
        tx,
      );
    });
    this.publish(folderId);
    return this.buildList(await this.access.contextFor(actor), folderId);
  }

  /** 候選對象：只回 id 與名稱，管理授權的人不需要 `role:read` / `user:read`（§6.2）。 */
  async searchSubjects(
    folderId: string,
    query: ListFileGrantSubjectsDto,
    actor: AuthUser,
  ): Promise<FileGrantSubjectListDto> {
    const ctx = await this.access.contextFor(actor);
    await this.assertCanShare(ctx, actor, folderId);
    const rows = await this.grants.searchSubjects(
      query.subjectType,
      query.keyword,
      SUBJECT_SEARCH_LIMIT,
    );
    return {
      items: rows.map((row) => ({
        subjectType: query.subjectType,
        id: row.id,
        name: row.name,
        hint: row.hint,
      })),
    };
  }

  /** 繼承到的授權（不含自己的），同一個對象取最高等級；自己已有同等或更高的不複製。 */
  private async copyInherited(
    ctx: FileAccessContext,
    folderId: string,
    actor: AuthUser,
    tx: DbOrTx,
  ) {
    const [, ...ancestors] = inheritanceChain(ctx.folders, folderId);
    const rows = await this.grants.listOn('fileFolder', [folderId, ...ancestors], tx);
    const now = Date.now();
    const direct = new Map<string, GrantLevel>();
    const inherited = new Map<string, ResourceGrantInsert>();
    for (const row of rows) {
      const key = `${row.subjectType}:${row.subjectId}`;
      if (row.resourceId === folderId) {
        direct.set(key, row.level);
        continue;
      }
      // 已過期的不計入存取，也就不必保留
      if (row.expiresAt && row.expiresAt.getTime() <= now) continue;
      const previous = inherited.get(key);
      if (previous && maxLevel(previous.level, row.level) === previous.level) continue;
      inherited.set(key, {
        resourceType: 'fileFolder',
        resourceId: folderId,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        level: row.level,
        expiresAt: row.expiresAt,
        grantedBy: actor.id,
      });
    }
    const toCopy = [...inherited].flatMap(([key, grant]) => {
      const existing = direct.get(key);
      return existing && levelRank(existing) >= levelRank(grant.level) ? [] : [grant];
    });
    // 自己已有、但等級較低的：覆寫成繼承來的較高等級
    const upgrades = toCopy.filter((copy) => direct.has(`${copy.subjectType}:${copy.subjectId}`));
    for (const grant of upgrades) {
      // oxlint-disable-next-line no-await-in-loop -- 同一個交易依序寫入；筆數是上層鏈上的授權數
      await this.grants.set(
        this.keyOf(folderId, grant.subjectType, grant.subjectId),
        { level: grant.level, expiresAt: grant.expiresAt ?? null, grantedBy: actor.id },
        tx,
      );
    }
    await this.grants.insertMissing(toCopy, tx);
    return toCopy;
  }

  private async buildList(
    ctx: FileAccessContext,
    folderId: string,
  ): Promise<FileFolderGrantListDto> {
    const chain = inheritanceChain(ctx.folders, folderId);
    const [rows, chainFolders] = await Promise.all([
      this.grants.listOn('fileFolder', chain),
      this.folders.findByIds(chain),
    ]);
    const names = new Map(chainFolders.map((folder) => [folder.id, folder.name]));
    const distance = new Map(chain.map((id, index) => [id, index]));
    const now = Date.now();
    const items: FileFolderGrantDto[] = rows
      .toSorted(
        (a, b) =>
          (distance.get(a.resourceId) ?? 0) - (distance.get(b.resourceId) ?? 0) ||
          levelRank(b.level) - levelRank(a.level) ||
          a.subjectName.localeCompare(b.subjectName),
      )
      .map((row) => ({
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        level: row.level,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        isExpired: row.expiresAt !== null && row.expiresAt.getTime() <= now,
        grantedAt: row.grantedAt.toISOString(),
        source:
          row.resourceId === folderId
            ? null
            : { folderId: row.resourceId, folderName: names.get(row.resourceId) ?? '' },
      }));
    return {
      folderId,
      inheritGrants: ctx.folders.get(folderId)?.inheritGrants ?? true,
      assignableLevels: ctx.assignableLevels(folderId),
      items,
    };
  }

  /** 資料夾存在（否則 404），而且操作者能管理它的授權（否則 403）。 */
  async assertCanShare(
    ctx: FileAccessContext,
    actor: AuthUser,
    folderId: string,
    tx?: DbOrTx,
  ): Promise<FileFolderRow> {
    const folder = await this.folders.findById(folderId, tx);
    if (!folder) throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId });
    if (!ctx.can('share', folderId)) {
      throw await this.access.deny(actor, 'share', 'fileFolder', folderId);
    }
    return folder;
  }

  /** 反提權：這些等級蘊含的動作，操作者在這個資料夾都要有（§6.1）。 */
  private assertGrantable(
    ctx: FileAccessContext,
    folderId: string,
    levels: readonly GrantLevel[],
  ): void {
    const missing = ctx.missingActions(levels, folderId);
    if (missing.length > 0) {
      throw new AppException('AUTHZ_ESCALATION', {
        missing: missing.map((action) => FILE_ACTION_PERMISSION[action]),
      });
    }
  }

  /** 授權的寫入與資料夾結構的寫入排隊：解析等級時看到的上層鏈不會在途中改變。 */
  private writeGrants<T>(work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return withTransaction(this.db, async (tx) => {
      await this.folders.lockTree(tx);
      return work(tx);
    });
  }

  private keyOf(folderId: string, subjectType: FileGrantSubjectType, subjectId: string): GrantKey {
    return { resourceType: 'fileFolder', resourceId: folderId, subjectType, subjectId };
  }

  private publish(folderId: string): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id: folderId }],
    });
  }
}

function snapshot(grant: {
  subjectType: string;
  subjectId: string;
  level: GrantLevel;
  expiresAt?: Date | null;
}) {
  return {
    subjectType: grant.subjectType,
    subjectId: grant.subjectId,
    level: grant.level,
    expiresAt: grant.expiresAt?.toISOString() ?? null,
  };
}
