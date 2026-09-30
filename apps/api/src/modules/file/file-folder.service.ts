import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import type { FileFolderRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';

import type {
  CreateFileFolderDto,
  EnsureFileFolderPathsDto,
  FileFolderDto,
  FileFolderListDto,
  FileFolderPathsDto,
  MoveFileItemsDto,
  MoveFileItemsResultDto,
  UpdateFileFolderDto,
} from './dto/file-folder.dto';
import { FileAccessRequestService } from './file-access-request.service';
import type { FileAccessContext } from './file-access.context';
import { FileAccessService } from './file-access.service';
import { FileFolderRepository } from './file-folder.repository';
import { MAX_FOLDER_DEPTH } from './file.constants';

/** 無法逐筆列出受影響的 id 時（遞迴刪除、批次移動）：前端退回失效該資源的所有實體。 */
const ANY_ID = '*';

/** 路徑樹的一個節點（`ensurePaths`）。 */
interface PathNode {
  name: string;
  children: Map<string, PathNode>;
  id?: string;
}

/**
 * 資料夾的業務規則（docs/architecture/backend/09-file.md §4.2）。
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
    private readonly events: DomainEventBus,
    private readonly access: FileAccessService,
    private readonly requests: FileAccessRequestService,
  ) {}

  /**
   * 全部的資料夾與操作者對每一個的能力：沒有權限的也列出，`canRead = false`（鎖住），
   * 申請中的標 `hasPendingAccessRequest`（docs/rbac/07-resource-grants.md §5.1、§6.5）。
   */
  async list(actor: AuthUser): Promise<FileFolderListDto> {
    const [ctx, rows, requested] = await Promise.all([
      this.access.contextFor(actor),
      this.repo.listAll(),
      this.requests.pendingFolderIdsOf(actor),
    ]);
    return {
      // 別人的個人資料夾與其他資料夾一致：列出但鎖住（§5.1）
      items: rows.map((row) => toDto(row, ctx, requested.has(row.id))),
      rootCapabilities: ctx.rootCapabilities(),
      personalFolderId:
        rows.find((row) => row.kind === 'personal' && row.ownerId === actor.id)?.id ?? null,
    };
  }

  /**
   * 在「資料夾確定存在」的交易內執行（登記上傳時建立檔案紀錄）：與遞迴刪除排隊，
   * 不會把檔案放進剛被刪除的資料夾。`folderId` 為 null / undefined 是根目錄，不必排隊。
   */
  async insideFolder<T>(
    folderId: string | null | undefined,
    work: (tx: DbOrTx) => Promise<T>,
  ): Promise<T> {
    if (!folderId) return work(this.db);
    return withTransaction(this.db, async (tx) => {
      await this.repo.lockTree(tx);
      await this.getOrThrow(folderId, tx);
      return work(tx);
    });
  }

  async create(dto: CreateFileFolderDto, actor: AuthUser): Promise<FileFolderDto> {
    const { created, ctx } = await this.writeTree(async (tx) => {
      const context = await this.access.contextFor(actor, tx);
      await this.access.assertCan(context, actor, 'create', dto.parentId);
      await this.assertDepth(dto.parentId, 1, tx);
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
    this.publish([{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.CREATE, id: created.id }]);
    // 新資料夾繼承上層的授權、建立者是自己：能力以上層推得（context 建立時它還不存在）
    return toDto(created, ctx, false, {
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

    const created = await this.writeTree(async (tx) => {
      const ctx = await this.access.contextFor(actor, tx);
      await this.access.assertCan(ctx, actor, 'create', dto.parentId);
      const maxDepth = Math.max(...dto.paths.map((path) => path.length));
      await this.assertDepth(dto.parentId, maxDepth, tx);

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
      this.publish([{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.CREATE }]);
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
    const { renamed, ctx } = await this.writeTree(async (tx) => {
      const context = await this.access.contextFor(actor, tx);
      const folder = await this.getReadableOrThrow(context, actor, id, tx);
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
    this.publish([{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id }]);
    return toDto(renamed, ctx);
  }

  /**
   * 把檔案與資料夾移到 `targetFolderId`（null 是根目錄）。
   * 資料夾：不存在回 `FILE_FOLDER_NOT_FOUND`；目的地是自己或自己的子孫回 `FILE_FOLDER_CYCLE`；
   * 目的地已有同名資料夾（含這次一起移進去的彼此同名）回 `FILE_FOLDER_NAME_CONFLICT`。
   * 檔案：已刪除的略過（批次移動途中有人刪除不讓整批失敗）。
   */
  async move(dto: MoveFileItemsDto, actor: AuthUser): Promise<MoveFileItemsResultDto> {
    const { targetFolderId } = dto;
    const result = await this.writeTree(async (tx) => {
      const ctx = await this.access.contextFor(actor, tx);
      const target = targetFolderId
        ? await this.getReadableOrThrow(ctx, actor, targetFolderId, tx)
        : undefined;
      await this.access.assertCan(ctx, actor, 'create', targetFolderId);

      const folders = await this.repo.findByIds(dto.folderIds, tx);
      assertNotSystem(folders);
      if (folders.length !== dto.folderIds.length) {
        const found = new Set(folders.map((folder) => folder.id));
        throw new AppException('FILE_FOLDER_NOT_FOUND', {
          folderIds: dto.folderIds.filter((id) => !found.has(id)),
        });
      }
      for (const folder of folders) {
        if (!ctx.canModify('update', folder.parentId, folder.createdBy)) {
          // oxlint-disable-next-line no-await-in-loop -- 第一個不能移動的就拒絕整批
          throw await this.access.deny(actor, 'update', 'fileFolder', folder.id);
        }
      }
      // 檔案：已刪除、上傳中、看不到的略過（同「途中被刪除」）；看得到但不能移動的拒絕整批
      const files = (await this.repo.findMovableFiles(dto.fileIds, tx)).filter((file) =>
        ctx.can('read', file.folderId),
      );
      for (const file of files) {
        if (!ctx.canModify('update', file.folderId, file.createdBy)) {
          // oxlint-disable-next-line no-await-in-loop -- 同上
          throw await this.access.deny(actor, 'update', 'file', file.id);
        }
      }
      const fileIds = files.map((file) => file.id);
      const moving = folders.filter((folder) => folder.parentId !== targetFolderId);
      if (moving.length > 0) {
        await this.assertMovable(moving, targetFolderId, tx);
      }

      const movedFolders = await this.repo.move(
        moving.map((folder) => folder.id),
        targetFolderId,
        actor.id,
        tx,
      );
      const movedFiles = await this.repo.moveFiles(fileIds, targetFolderId, actor.id, tx);
      if (movedFolders.length + movedFiles > 0) {
        await this.audit.record(
          {
            action: 'file.move',
            resourceType: 'fileFolder',
            resourceId: targetFolderId,
            resourceName: target?.name ?? '/',
            changes: {
              after: {
                targetFolderId,
                fileIds,
                folderIds: movedFolders.map((folder) => folder.id),
              },
            },
          },
          tx,
        );
      }
      return { movedFolders: movedFolders.length, movedFiles };
    });

    const changes: ResourceChangeWire[] = [];
    if (result.movedFolders > 0) {
      changes.push({ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id: ANY_ID });
    }
    if (result.movedFiles > 0) {
      changes.push({ resource: ChangeSource.FILE, kind: ChangeKind.UPDATE, id: ANY_ID });
    }
    this.publish(changes);
    return result;
  }

  /** 遞迴刪除：資料夾、所有子孫資料夾、其中的檔案。 */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const removed = await this.writeTree(async (tx) => {
      const ctx = await this.access.contextFor(actor, tx);
      const folder = await this.getReadableOrThrow(ctx, actor, id, tx);
      assertNotSystem([folder]);
      if (!ctx.canModify('delete', folder.parentId, folder.createdBy)) {
        throw await this.access.deny(actor, 'delete', 'fileFolder', id);
      }
      const folderIds = await this.repo.findDescendantIds([id], tx);
      // 只靠擁有者規則時：子樹裡有別人的東西，本人不能刪（docs/rbac/07-resource-grants.md §4）
      if (
        !ctx.can('delete', folder.parentId) &&
        (await this.repo.hasItemsNotCreatedBy(folderIds, actor.id, tx))
      ) {
        throw await this.access.deny(actor, 'delete', 'fileFolder', id, 'not-owner');
      }
      // 子樹裡的私人資料夾（中斷繼承）：對上層有刪除權不代表對它有（§4）
      const protectedFolder = folderIds.find(
        (folderId) =>
          ctx.folders.get(folderId)?.inheritGrants === false && !ctx.can('delete', folderId),
      );
      if (protectedFolder) {
        throw await this.access.deny(actor, 'delete', 'fileFolder', id, 'protected-subfolder');
      }
      const fileCount = await this.repo.softDeleteFilesIn(folderIds, actor.id, tx);
      await this.repo.softDelete(folderIds, actor.id, tx);
      await this.audit.record(
        {
          action: 'fileFolder.delete',
          resourceType: 'fileFolder',
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
    this.publish(changes);
  }

  /** 結構的寫入：交易內先排隊；同名的競態（鎖以外的寫入）也轉成業務錯誤。 */
  private async writeTree<T>(work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.db, async (tx) => {
        await this.repo.lockTree(tx);
        return work(tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppException('FILE_FOLDER_NAME_CONFLICT');
      throw error;
    }
  }

  /** 存在（否則 404）而且讀得到（鎖住的資料夾 → 403，docs/rbac/07-resource-grants.md §5.1）。 */
  private async getReadableOrThrow(
    ctx: FileAccessContext,
    actor: AuthUser,
    id: string,
    tx: DbOrTx,
  ): Promise<FileFolderRow> {
    const folder = await this.getOrThrow(id, tx);
    if (!ctx.can('read', id)) throw await this.access.deny(actor, 'read', 'fileFolder', id);
    return folder;
  }

  private async getOrThrow(id: string, tx: DbOrTx): Promise<FileFolderRow> {
    const folder = await this.repo.findById(id, tx);
    if (!folder) throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId: id });
    return folder;
  }

  /** 在 `parentId` 底下再加 `levels` 層是否超過深度上限。 */
  private async assertDepth(parentId: string | null, levels: number, tx: DbOrTx): Promise<void> {
    const depth = parentId ? (await this.repo.findAncestorIds(parentId, tx)).length : 0;
    if (parentId && depth === 0) {
      throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId: parentId });
    }
    if (depth + levels > MAX_FOLDER_DEPTH) {
      throw new AppException('VALIDATION_FAILED', { field: 'depth', max: MAX_FOLDER_DEPTH });
    }
  }

  private async assertMovable(
    moving: readonly FileFolderRow[],
    targetFolderId: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    if (targetFolderId) {
      // 目的地往上的鏈上出現任何一個要移動的資料夾 → 移進自己或自己的子孫
      const ancestors = new Set(await this.repo.findAncestorIds(targetFolderId, tx));
      const cyclic = moving.filter((folder) => ancestors.has(folder.id));
      if (cyclic.length > 0) {
        throw new AppException('FILE_FOLDER_CYCLE', { folderIds: cyclic.map((f) => f.id) });
      }
    }

    const names = new Set<string>();
    for (const folder of moving) {
      const key = folder.name.toLowerCase();
      const duplicated =
        names.has(key) ||
        // 交易內的查詢依序執行；一次移動的資料夾數有上限（MAX_MOVE_ITEMS）
        // oxlint-disable-next-line no-await-in-loop -- 見上
        (await this.repo.hasSibling(targetFolderId, folder.name, folder.id, tx));
      if (duplicated) throw new AppException('FILE_FOLDER_NAME_CONFLICT', { name: folder.name });
      names.add(key);
    }
  }

  private publish(changes: ResourceChangeWire[]): void {
    if (changes.length === 0) return;
    this.events.publish(DomainEvent.RESOURCE_CHANGED, { changes });
  }
}

/** 系統資料夾（共用、私人、個人）不能改名、移動、刪除（docs/rbac/07-resource-grants.md §12）。 */
function assertNotSystem(folders: readonly FileFolderRow[]): void {
  const system = folders.filter((folder) => folder.kind !== 'normal');
  if (system.length > 0) {
    throw new AppException('FILE_FOLDER_SYSTEM_PROTECTED', {
      folderIds: system.map((folder) => folder.id),
    });
  }
}

function toDto(
  row: FileFolderRow,
  ctx: FileAccessContext,
  hasPendingAccessRequest = false,
  capabilities = ctx.folderCapabilities(row),
): FileFolderDto {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    kind: row.kind,
    inheritGrants: row.inheritGrants,
    hasPendingAccessRequest,
    capabilities,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
