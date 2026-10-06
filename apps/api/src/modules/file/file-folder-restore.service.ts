import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { DbOrTx } from '@/core/database';
import { AppException } from '@/core/errors';
import { RESOURCE_TYPE } from '@/core/resource';
import { AuditService } from '@/modules/audit-log/audit.service';

import type { RestoredFileFolderDto } from './dto/file-folder.dto';
import { FileAccessService } from './file-access.service';
import { FileFolderRepository } from './file-folder.repository';
import {
  assertNotSystem,
  FileFolderRules,
  folderParentDeleted,
  toFolderDto,
} from './file-folder.rules';
import { FileImageService } from './file-image.service';
import { FileObjectsService } from './file-objects.service';
import { ANY_ID, MAX_FOLDER_DEPTH } from './file.constants';
import { FileRepository } from './file.repository';

/**
 * 從回收桶還原資料夾（`POST /file-folders/:id/restore`，docs/architecture/backend/13-trash.md §7.1）：
 * 同一次刪除的子樹與檔案一起回來，物件已不在的檔案維持刪除；權限以還原之後的結構照刪除的規則判斷。
 */
@Injectable()
export class FileFolderRestoreService {
  constructor(
    private readonly repo: FileFolderRepository,
    private readonly audit: AuditService,
    private readonly access: FileAccessService,
    private readonly rules: FileFolderRules,
    private readonly files: FileRepository,
    private readonly objects: FileObjectsService,
    private readonly images: FileImageService,
  ) {}

  /**
   * 還原刪除的資料夾（`POST /file-folders/:id/restore`，docs/architecture/backend/14-revisions.md §9.2 D5、D10；docs/architecture/backend/13-trash.md §7.1）。
   *
   * - 只還原 **同一次刪除** 的子樹（`deletion_id` 相同）：之前個別刪掉的子資料夾與檔案維持刪除。
   * - 上層資料夾已刪除 → `409 FILE_FOLDER_RESTORE_CONFLICT`（`reason: 'parentDeleted'`）；同一層已有同名的資料夾 →
   *   `409 FILE_FOLDER_NAME_CONFLICT`（`details.conflictingId`）。系統資料夾只由系統刪除，不能還原。
   * - 同一批的檔案逐一確認物件還在：不在的維持刪除（`filesSkipped`），不讓整個資料夾還原失敗——資料夾本身沒有內容，
   *   擋下來只會讓其他檔案也救不回來；那些檔案之後在回收桶的「檔案」分頁個別出現（原本的資料夾已還原）。
   * - 權限與刪除相同，而且以 **還原之後** 的結構判斷：在同一個交易內先還原，再照刪除的檢查（讀得到、能刪除、
   *   子樹沒有別人的東西或權限不足的私人資料夾）確認「現在能不能刪掉它」，不能就 rollback。授權是繼承的，
   *   資料夾不在結構裡時無法判斷，還原之後判斷才與刪除完全一致。
   */
  async restore(id: string, actor: AuthUser): Promise<RestoredFileFolderDto> {
    const folder = await this.repo.findDeletedById(id);
    if (!folder) {
      throw new AppException(
        (await this.repo.findById(id)) ? 'FILE_FOLDER_NOT_DELETED' : 'FILE_FOLDER_NOT_FOUND',
      );
    }
    assertNotSystem([folder]);
    if (folder.parentId && (await this.repo.isDeletedOrGone(folder.parentId))) {
      throw folderParentDeleted(folder.parentId);
    }
    // 物件的確認在排隊之前（HeadObject 可能很多）：之後在交易內只還原確認過的檔案
    const batchIds = await this.repo.findDeletedBatchIds(id, folder.deletionId);
    const candidates = await this.files.findDeletedInBatch(batchIds, folder.deletionId);
    const probes = await this.objects.probe(candidates);
    const restorable = candidates.filter((file) => probes.get(file.id)?.original);
    const permissions = await this.access.permissionsOf(actor);

    const result = await this.rules.writeTree(async (tx) => {
      if (folder.parentId && !(await this.repo.findById(folder.parentId, tx))) {
        throw folderParentDeleted(folder.parentId);
      }
      const conflictingId = await this.repo.findSiblingId(folder.parentId, folder.name, id, tx);
      if (conflictingId) {
        throw new AppException('FILE_FOLDER_NAME_CONFLICT', { name: folder.name, conflictingId });
      }
      const restoredFolders = await this.repo.restore(
        batchIds,
        { actorId: actor.id, deletionId: folder.deletionId },
        tx,
      );
      const root = restoredFolders.find((row) => row.id === id);
      // 檢查之後被別人搶先還原
      if (!root) throw new AppException('FILE_FOLDER_NOT_DELETED');
      await this.rules.assertDepth(folder.parentId, await this.subtreeHeight(id, tx), tx);

      const restoredFiles = await this.files.restore(
        restorable.map((file) => file.id),
        { actorId: actor.id, deletionId: folder.deletionId },
        tx,
      );
      const restoredFileIds = new Set(restoredFiles.map((file) => file.id));
      const lost = (key: 'thumbnailLost' | 'variantsLost') =>
        [...restoredFileIds].filter((fileId) => probes.get(fileId)?.[key]);
      const variantsLost = lost('variantsLost');
      await this.files.clearThumbnail(lost('thumbnailLost'), tx);
      await this.files.resetVariants(variantsLost, tx);

      // 以還原之後的結構照刪除的規則檢查（見上方說明）；不能就整個 rollback
      const ctx = await this.access.contextFor(actor, tx, permissions);
      if (!ctx.can('read', id)) throw await this.access.deny(actor, 'read', 'fileFolder', id);
      const folderIds = restoredFolders.map((row) => row.id);
      await this.rules.assertRemovable(ctx, actor, root, folderIds, tx);

      const filesSkipped = candidates.length - restoredFiles.length;
      await this.audit.record(
        {
          action: 'fileFolder.restore',
          resourceType: RESOURCE_TYPE.FILE_FOLDER,
          resourceId: id,
          resourceName: root.name,
          changes: { after: { name: root.name, parentId: root.parentId } },
          metadata: {
            deletedAt: folder.deletedAt?.toISOString(),
            deletionId: folder.deletionId,
            folderCount: folderIds.length,
            fileCount: restoredFiles.length,
            filesSkipped,
          },
        },
        tx,
      );
      return {
        // 軟刪除時保留標籤的指派（docs/architecture/backend/18-tag.md §7.2 D9）：還原後跟著回來
        dto: toFolderDto(root, ctx, await this.rules.tagsFor(root.id)),
        foldersRestored: folderIds.length,
        filesRestored: restoredFiles.length,
        filesSkipped,
        variantsLost,
      };
    });

    for (const fileId of result.variantsLost) this.images.schedule(fileId);
    const changes: ResourceChangeWire[] = [
      // 重新出現：以 create 宣告（回收桶由前端的依賴圖跟著失效）
      { resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.CREATE, id },
    ];
    if (result.filesRestored > 0) {
      changes.push({ resource: ChangeSource.FILE, kind: ChangeKind.CREATE, id: ANY_ID });
    }
    this.rules.publish(changes);
    return {
      ...result.dto,
      foldersRestored: result.foldersRestored,
      filesRestored: result.filesRestored,
      filesSkipped: result.filesSkipped,
    };
  }

  /** 以 `id` 為根的子樹高度（只有自己 = 1）。 */
  private subtreeHeight(id: string, tx: DbOrTx): Promise<number> {
    return this.repo.findMaxSubtreeHeight([id], MAX_FOLDER_DEPTH + 1, tx);
  }
}
