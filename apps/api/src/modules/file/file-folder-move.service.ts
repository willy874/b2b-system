import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { DbOrTx } from '@/core/database';
import { AppException } from '@/core/errors';
import type { FileFolderRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';

import type { MoveFileItemsDto, MoveFileItemsResultDto } from './dto/file-folder.dto';
import { FileAccessService } from './file-access.service';
import { FileFolderRepository } from './file-folder.repository';
import { assertNotSystem, FileFolderRules, folderDepthExceeded } from './file-folder.rules';
import { ANY_ID, MAX_FOLDER_DEPTH } from './file.constants';

/**
 * 移動檔案與資料夾（`POST /files/move`，docs/architecture/backend/09-file.md §4.2）：權限、循環、深度上限、
 * 目的地的同名檢查都在樹鎖內做（`FileFolderRules.writeTree`）。
 */
@Injectable()
export class FileFolderMoveService {
  constructor(
    private readonly repo: FileFolderRepository,
    private readonly audit: AuditService,
    private readonly access: FileAccessService,
    private readonly rules: FileFolderRules,
  ) {}

  /**
   * 把檔案與資料夾移到 `targetFolderId`（null 是根目錄）。
   * 資料夾：不存在回 `FILE_FOLDER_NOT_FOUND`；目的地是自己或自己的子孫回 `FILE_FOLDER_CYCLE`；
   * 目的地已有同名資料夾（含這次一起移進去的彼此同名）回 `FILE_FOLDER_NAME_CONFLICT`。
   * 檔案：已刪除的略過（批次移動途中有人刪除不讓整批失敗）。
   */
  async move(dto: MoveFileItemsDto, actor: AuthUser): Promise<MoveFileItemsResultDto> {
    const { targetFolderId } = dto;
    const permissions = await this.access.permissionsOf(actor);
    const result = await this.rules.writeTree(async (tx) => {
      const ctx = await this.access.contextFor(actor, tx, permissions);
      const target = targetFolderId
        ? await this.rules.getReadableOrThrow(ctx, actor, targetFolderId, tx)
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
    this.rules.publish(changes);
    return result;
  }

  private async assertMovable(
    moving: readonly FileFolderRow[],
    targetFolderId: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    let targetDepth = 0;
    if (targetFolderId) {
      // 目的地往上的鏈上出現任何一個要移動的資料夾 → 移進自己或自己的子孫
      const ancestors = new Set(await this.repo.findAncestorIds(targetFolderId, tx));
      const cyclic = moving.filter((folder) => ancestors.has(folder.id));
      if (cyclic.length > 0) {
        throw new AppException('FILE_FOLDER_CYCLE', { folderIds: cyclic.map((f) => f.id) });
      }
      targetDepth = ancestors.size;
    }
    // 移動後最深的一層 = 目的地的深度 ＋ 被移動的子樹高度：遞迴 CTE 與前端的樹都假設深度有上限
    const height = await this.repo.findMaxSubtreeHeight(
      moving.map((folder) => folder.id),
      MAX_FOLDER_DEPTH + 1,
      tx,
    );
    if (targetDepth + height > MAX_FOLDER_DEPTH) throw folderDepthExceeded('targetFolderId');

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
}
