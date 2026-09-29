import { ChangeKind, ChangeSource } from '@game-editor/realtime';
import type { ResourceChangeWire } from '@game-editor/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
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
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly repo: FileFolderRepository,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  async list(): Promise<FileFolderListDto> {
    const rows = await this.repo.listAll();
    return { items: rows.map(toDto) };
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
    const created = await this.writeTree(async (tx) => {
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
      return row;
    });
    this.publish([{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.CREATE, id: created.id }]);
    return toDto(created);
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
            if (found) child.id = found.id;
            else missing.push({ parentId, node: child });
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
    const renamed = await this.writeTree(async (tx) => {
      const folder = await this.getOrThrow(id, tx);
      if (folder.name === dto.name) return folder;
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
      return row;
    });
    this.publish([{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id }]);
    return toDto(renamed);
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
      const target = targetFolderId ? await this.getOrThrow(targetFolderId, tx) : undefined;

      const folders = await this.repo.findByIds(dto.folderIds, tx);
      if (folders.length !== dto.folderIds.length) {
        const found = new Set(folders.map((folder) => folder.id));
        throw new AppException('FILE_FOLDER_NOT_FOUND', {
          folderIds: dto.folderIds.filter((id) => !found.has(id)),
        });
      }
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
      const movedFiles = await this.repo.moveFiles(dto.fileIds, targetFolderId, actor.id, tx);
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
                fileIds: dto.fileIds,
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
      const folder = await this.getOrThrow(id, tx);
      const folderIds = await this.repo.findDescendantIds([id], tx);
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

function toDto(row: FileFolderRow): FileFolderDto {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
