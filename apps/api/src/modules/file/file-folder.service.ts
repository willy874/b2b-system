import { randomUUID } from 'node:crypto';

import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { RESOURCE_TYPE } from '@/core/resource';
import type { FileFolderRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { TagService } from '@/modules/tag/tag.service';

import type {
  CreateFileFolderDto,
  EnsureFileFolderPathsDto,
  FileFolderDto,
  FileFolderListDto,
  FileFolderPathsDto,
  UpdateFileFolderDto,
} from './dto/file-folder.dto';
import { FileAccessRequestService } from './file-access-request.service';
import { FileAccessService } from './file-access.service';
import { FileFolderRepository } from './file-folder.repository';
import { assertNotSystem, FileFolderRules, toFolderDto } from './file-folder.rules';
import { FileSystemFolderService } from './file-system-folder.service';
import { ANY_ID } from './file.constants';

/** 路徑樹的一個節點（`ensurePaths`）。 */
interface PathNode {
  name: string;
  children: Map<string, PathNode>;
  id?: string;
}

/**
 * 資料夾的業務規則（docs/architecture/backend/09-file.md §4.2）：列表、建立（含上傳資料夾）、改名、刪除。
 * 移動在 `FileFolderMoveService`、從回收桶還原在 `FileFolderRestoreService`，三者共用 `FileFolderRules`。
 *
 * - 同一層不可同名（不分大小寫）；資料夾不可移到自己或自己的子孫底下。
 * - 結構的寫入（建立、改名、移動、刪除）在交易內先取 `lockTree()`，檢查與寫入之間沒有空窗。
 * - 刪除是遞迴的：子孫資料夾與其中的檔案一起軟刪除，物件儲存的內容交給維護排程清除。
 */
@Injectable()
export class FileFolderService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: FileFolderRepository,
    private readonly audit: AuditService,
    private readonly access: FileAccessService,
    private readonly requests: FileAccessRequestService,
    private readonly rules: FileFolderRules,
    private readonly tags: TagService,
    private readonly systemFolders: FileSystemFolderService,
  ) {}

  /**
   * 全部的資料夾與操作者對每一個的能力：沒有權限的也列出，`canRead = false`（鎖住），
   * 申請中的標 `hasPendingAccessRequest`（docs/rbac/07-resource-grants.md §5.1、§6.5）。
   *
   * 操作者還沒有個人資料夾時當場補建（冪等）：平常由啟動與 `permissions.changed` 建立，但兩者都可能錯過——
   * 廣播不保證送達、資料庫在程序執行中被重灌（E2E 的 global-setup）。補不了（沒有檔案權限）就照實回 null。
   */
  async list(actor: AuthUser): Promise<FileFolderListDto> {
    const result = await this.load(actor);
    if (result.personalFolderId !== null) return result;
    const created = await this.systemFolders.ensurePersonalFolders([actor.id], {
      onlyEligible: true,
    });
    return created > 0 ? this.load(actor) : result;
  }

  private async load(actor: AuthUser): Promise<FileFolderListDto> {
    const [ctx, rows, requested] = await Promise.all([
      this.access.contextFor(actor),
      this.repo.listAll(),
      this.requests.pendingFolderIdsOf(actor),
    ]);
    const tags = await this.tags.tagsOf(
      RESOURCE_TYPE.FILE_FOLDER,
      rows.map((row) => row.id),
    );
    return {
      // 別人的個人資料夾與其他資料夾一致：列出但鎖住（§5.1）
      items: rows.map((row) =>
        toFolderDto(row, ctx, tags.get(row.id) ?? [], requested.has(row.id)),
      ),
      rootCapabilities: ctx.rootCapabilities(),
      personalFolderId:
        rows.find((row) => row.kind === 'personal' && row.ownerId === actor.id)?.id ?? null,
    };
  }

  /**
   * 在「資料夾確定存在」的交易內執行（登記上傳時建立檔案紀錄）：與遞迴刪除排隊，
   * 不會把檔案放進剛被刪除的資料夾。`folderId` 為 null / undefined 是根目錄，不必排隊，但仍在交易內
   * （容量的佔用與 INSERT 同生共死，docs/architecture/05-tenancy.md §13.3 D8）。
   */
  async insideFolder<T>(
    folderId: string | null | undefined,
    work: (tx: DbOrTx) => Promise<T>,
  ): Promise<T> {
    if (!folderId) return withTransaction(this.db, work);
    return withTransaction(this.db, async (tx) => {
      await this.repo.lockTree(tx);
      await this.rules.getOrThrow(folderId, tx);
      return work(tx);
    });
  }

  /**
   * 在「資料夾確定還在」的交易內執行（還原檔案）：與遞迴刪除排隊，檢查之後資料夾才被刪除時拋 `missing()`。
   * `folderId` 為 null 是根目錄，不必排隊，但仍在交易內。
   */
  async withinLiveFolder<T>(
    folderId: string | null,
    missing: () => AppException,
    work: (tx: DbOrTx) => Promise<T>,
  ): Promise<T> {
    return withTransaction(this.db, async (tx) => {
      if (folderId) {
        await this.repo.lockTree(tx);
        if (!(await this.repo.findById(folderId, tx))) throw missing();
      }
      return work(tx);
    });
  }

  async create(dto: CreateFileFolderDto, actor: AuthUser): Promise<FileFolderDto> {
    const permissions = await this.access.permissionsOf(actor);
    const { created, ctx } = await this.rules.writeTree(async (tx) => {
      const context = await this.access.contextFor(actor, tx, permissions);
      await this.access.assertCan(context, actor, 'create', dto.parentId);
      await this.rules.assertDepth(dto.parentId, 1, tx, 'name');
      if (await this.repo.hasSibling(dto.parentId, dto.name, undefined, tx)) {
        throw new AppException('FILE_FOLDER_NAME_CONFLICT', { name: dto.name });
      }
      const [row] = await this.repo.create(
        [{ name: dto.name, parentId: dto.parentId, createdBy: actor.id, updatedBy: actor.id }],
        tx,
      );
      if (!row) throw new Error('建立資料夾失敗');
      await this.audit.record(
        {
          action: 'fileFolder.create',
          resourceType: 'fileFolder',
          resourceId: row.id,
          resourceName: row.name,
          changes: { after: { name: row.name, parentId: row.parentId } },
        },
        tx,
      );
      return { created: row, ctx: context };
    });
    this.rules.publish([
      { resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.CREATE, id: created.id },
    ]);
    // 新資料夾繼承上層的授權、建立者是自己：能力以上層推得（context 建立時它還不存在）
    return toFolderDto(created, ctx, [], false, {
      canRead: true,
      canCreate: ctx.can('create', created.parentId),
      canUpdate: ctx.canModify('update', created.parentId, created.createdBy),
      canDelete: ctx.canModify('delete', created.parentId, created.createdBy),
      canShare: ctx.can('share', created.parentId),
    });
  }

  /**
   * 上傳資料夾：確保每條路徑（從 `parentId` 起算）都存在，已存在的同名資料夾直接沿用。
   * 一層一層處理：每層一次查出既有的子資料夾、一次建立缺少的，深度 32 也只有幾十個查詢。
   */
  async ensurePaths(dto: EnsureFileFolderPathsDto, actor: AuthUser): Promise<FileFolderPathsDto> {
    const root: PathNode = { name: '', children: new Map() };
    for (const path of dto.paths) {
      let node = root;
      for (const name of path) {
        const key = name.toLowerCase();
        let child = node.children.get(key);
        if (!child) {
          child = { name, children: new Map() };
          node.children.set(key, child);
        }
        node = child;
      }
    }

    const permissions = await this.access.permissionsOf(actor);
    const created = await this.rules.writeTree(async (tx) => {
      const ctx = await this.access.contextFor(actor, tx, permissions);
      await this.access.assertCan(ctx, actor, 'create', dto.parentId);
      const maxDepth = Math.max(...dto.paths.map((path) => path.length));
      await this.rules.assertDepth(dto.parentId, maxDepth, tx, 'paths');

      const inserted: FileFolderRow[] = [];
      let level: { parentId: string | null; node: PathNode }[] = [
        { parentId: dto.parentId, node: root },
      ];
      while (level.length > 0) {
        // 下一層的上層 id 要等這一層建好才知道；同一個交易的查詢也只能依序執行
        // oxlint-disable-next-line no-await-in-loop -- 見上
        const existing = await this.repo.findChildren(
          level.map((entry) => entry.parentId),
          tx,
        );
        const byKey = new Map(
          existing.map((row) => [`${row.parentId ?? ''}/${row.name.toLowerCase()}`, row]),
        );
        const missing: { parentId: string | null; node: PathNode }[] = [];
        for (const { parentId, node } of level) {
          for (const [key, child] of node.children) {
            const found = byKey.get(`${parentId ?? ''}/${key}`);
            if (found) {
              // 沿用既有的資料夾：之後會往裡面建子資料夾或上傳，要能在裡面建立。
              // 新建的資料夾繼承上層、建立者是自己，不必再檢查
              // oxlint-disable-next-line no-await-in-loop -- 同一個交易內依序；只在沒有權限時才寫稽核
              await this.access.assertCan(ctx, actor, 'create', found.id);
              child.id = found.id;
            } else missing.push({ parentId, node: child });
          }
        }
        // oxlint-disable-next-line no-await-in-loop -- 同上：逐層建立
        const rows = await this.repo.create(
          missing.map(({ parentId, node }) => ({
            name: node.name,
            parentId,
            createdBy: actor.id,
            updatedBy: actor.id,
          })),
          tx,
        );
        // RETURNING 的順序與 VALUES 相同
        rows.forEach((row, index) => {
          const entry = missing[index];
          if (entry) entry.node.id = row.id;
        });
        inserted.push(...rows);

        level = level.flatMap(({ node }) =>
          [...node.children.values()].flatMap((child) =>
            child.id && child.children.size > 0 ? [{ parentId: child.id, node: child }] : [],
          ),
        );
      }

      for (const row of inserted) {
        // 同一個交易（一條連線）上的寫入本來就依序執行
        // oxlint-disable-next-line no-await-in-loop -- 見上
        await this.audit.record(
          {
            action: 'fileFolder.create',
            resourceType: 'fileFolder',
            resourceId: row.id,
            resourceName: row.name,
            changes: { after: { name: row.name, parentId: row.parentId } },
          },
          tx,
        );
      }
      return inserted;
    });

    if (created.length > 0) {
      this.rules.publish([{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.CREATE }]);
    }
    return {
      items: dto.paths.map((path) => {
        let node: PathNode | undefined = root;
        for (const name of path) node = node?.children.get(name.toLowerCase());
        if (!node?.id) throw new Error('資料夾路徑沒有對應的 id');
        return { path, id: node.id };
      }),
    };
  }

  async rename(id: string, dto: UpdateFileFolderDto, actor: AuthUser): Promise<FileFolderDto> {
    const permissions = await this.access.permissionsOf(actor);
    const { renamed, ctx } = await this.rules.writeTree(async (tx) => {
      const context = await this.access.contextFor(actor, tx, permissions);
      const folder = await this.rules.getReadableOrThrow(context, actor, id, tx);
      assertNotSystem([folder]);
      if (!context.canModify('update', folder.parentId, folder.createdBy)) {
        throw await this.access.deny(actor, 'update', 'fileFolder', id);
      }
      if (folder.name === dto.name) return { renamed: folder, ctx: context };
      if (await this.repo.hasSibling(folder.parentId, dto.name, id, tx)) {
        throw new AppException('FILE_FOLDER_NAME_CONFLICT', { name: dto.name });
      }
      const row = await this.repo.rename(id, { name: dto.name, updatedBy: actor.id }, tx);
      if (!row) throw new AppException('FILE_FOLDER_NOT_FOUND');
      await this.audit.record(
        {
          action: 'fileFolder.update',
          resourceType: 'fileFolder',
          resourceId: id,
          resourceName: dto.name,
          changes: { before: { name: folder.name }, after: { name: dto.name } },
        },
        tx,
      );
      return { renamed: row, ctx: context };
    });
    this.rules.publish([{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id }]);
    return toFolderDto(renamed, ctx, await this.rules.tagsFor(id));
  }

  /**
   * 遞迴刪除＝移到回收桶：資料夾、所有子孫資料夾、其中的檔案帶同一個 `deletion_id`（docs/architecture/backend/14-revisions.md §9.2 D5），
   * 還原時整批回來。物件儲存的內容保留到永久刪除（docs/architecture/backend/13-trash.md §7）。
   */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const deletionId = randomUUID();
    const permissions = await this.access.permissionsOf(actor);
    const removed = await this.rules.writeTree(async (tx) => {
      const ctx = await this.access.contextFor(actor, tx, permissions);
      const folder = await this.rules.getReadableOrThrow(ctx, actor, id, tx);
      assertNotSystem([folder]);
      const folderIds = await this.repo.findDescendantIds([id], tx);
      await this.rules.assertRemovable(ctx, actor, folder, folderIds, tx);
      // 資料夾與檔案同一個時間與 deletion_id：回收桶以它們判斷「同一次刪除」
      const stamp = { actorId: actor.id, deletionId, deletedAt: new Date() };
      const fileCount = await this.repo.softDeleteFilesIn(folderIds, stamp, tx);
      await this.repo.softDelete(folderIds, stamp, tx);
      await this.audit.record(
        {
          action: 'fileFolder.delete',
          resourceType: RESOURCE_TYPE.FILE_FOLDER,
          resourceId: id,
          resourceName: folder.name,
          changes: {
            before: {
              name: folder.name,
              parentId: folder.parentId,
              folderCount: folderIds.length,
              fileCount,
            },
          },
          metadata: { deletionId },
        },
        tx,
      );
      return { fileCount };
    });

    const changes: ResourceChangeWire[] = [
      { resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.DELETE, id },
    ];
    if (removed.fileCount > 0) {
      changes.push({ resource: ChangeSource.FILE, kind: ChangeKind.DELETE, id: ANY_ID });
    }
    this.rules.publish(changes);
  }

  /**
   * 能不能改這個資料夾的標籤（`TagService` 的 resolver，docs/architecture/backend/18-tag.md §7.2 D5）：跟改名同一個判斷——
   * 讀得到、能改名；系統資料夾（共用、私人、個人）不能改名，也不能貼標籤。
   */
  async assertTaggable(id: string, actor: AuthUser): Promise<{ name: string }> {
    const ctx = await this.access.contextFor(actor);
    const folder = await this.rules.getReadableOrThrow(ctx, actor, id, this.db);
    assertNotSystem([folder]);
    if (!ctx.canModify('update', folder.parentId, folder.createdBy)) {
      throw await this.access.deny(actor, 'update', 'fileFolder', id);
    }
    return { name: folder.name };
  }

  /** 標籤被改了（交易提交後）：推一筆資料夾更新（D10）。 */
  publishTagsChanged(id: string): void {
    this.rules.publish([{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id }]);
  }
}
