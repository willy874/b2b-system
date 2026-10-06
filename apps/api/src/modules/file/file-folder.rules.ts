import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { DbOrTx } from '@/core/database';
import { AppException, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import type { FileFolderRow } from '@/db/schema';
import type { TagSummaryDto } from '@/modules/tag/dto/tag.dto';
import { TagService } from '@/modules/tag/tag.service';

import type { FileFolderDto } from './dto/file-folder.dto';
import type { FileAccessContext } from './file-access.context';
import { FileAccessService } from './file-access.service';
import { FileFolderTree } from './file-folder-tree';
import { FileFolderRepository } from './file-folder.repository';
import { MAX_FOLDER_DEPTH } from './file.constants';

/**
 * 資料夾的共用規則（docs/architecture/backend/09-file.md §4.2）：`FileFolderService`（建立、改名、刪除）、
 * `FileFolderMoveService`（移動）、`FileFolderRestoreService`（還原）都經過這裡。
 *
 * - 結構的寫入一律走 `writeTree()`：交易內先取樹鎖排隊，同名的競態轉成 `FILE_FOLDER_NAME_CONFLICT`。
 * - 讀得到（`getReadableOrThrow`）、深度上限（`assertDepth`）、刪除子樹的附加條件（`assertRemovable`）。
 * - 推播與標籤的小工具。
 */
@Injectable()
export class FileFolderRules {
  constructor(
    private readonly repo: FileFolderRepository,
    private readonly access: FileAccessService,
    private readonly tree: FileFolderTree,
    private readonly tags: TagService,
    private readonly events: DomainEventBus,
  ) {}

  /** 結構的寫入：交易內先排隊；同名的競態（鎖以外的寫入）也轉成業務錯誤。 */
  async writeTree<T>(work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    try {
      return await this.tree.write(work);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppException('FILE_FOLDER_NAME_CONFLICT');
      throw error;
    }
  }

  /** 存在（否則 404）而且讀得到（鎖住的資料夾 → 403，docs/rbac/07-resource-grants.md §5.1）。 */
  async getReadableOrThrow(
    ctx: FileAccessContext,
    actor: AuthUser,
    id: string,
    tx: DbOrTx,
  ): Promise<FileFolderRow> {
    const folder = await this.getOrThrow(id, tx);
    if (!ctx.can('read', id)) throw await this.access.deny(actor, 'read', 'fileFolder', id);
    return folder;
  }

  async getOrThrow(id: string, tx: DbOrTx): Promise<FileFolderRow> {
    const folder = await this.repo.findById(id, tx);
    if (!folder) throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId: id });
    return folder;
  }

  /**
   * 在 `parentId` 底下再加 `levels` 層是否超過深度上限。`field` 是請求裡要標錯的欄位
   * （建立：`name`、上傳資料夾：`paths`；還原沒有請求本體，不帶）。
   */
  async assertDepth(
    parentId: string | null,
    levels: number,
    tx: DbOrTx,
    field?: 'name' | 'paths',
  ): Promise<void> {
    const depth = parentId ? (await this.repo.findAncestorIds(parentId, tx)).length : 0;
    if (parentId && depth === 0) {
      throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId: parentId });
    }
    if (depth + levels > MAX_FOLDER_DEPTH) throw folderDepthExceeded(field);
  }

  /**
   * 刪除一個資料夾子樹的附加條件（docs/rbac/07-resource-grants.md §4）；刪除與還原共用。
   * 能刪除這個資料夾本身（`can_remove`）之外：只靠擁有者規則時子樹裡不能有別人的東西；子樹裡的私人資料夾
   * （中斷繼承）要另外有刪除權。
   */
  async assertRemovable(
    ctx: FileAccessContext,
    actor: AuthUser,
    folder: FileFolderRow,
    folderIds: readonly string[],
    tx: DbOrTx,
  ): Promise<void> {
    if (!ctx.canModify('delete', folder.parentId, folder.createdBy)) {
      throw await this.access.deny(actor, 'delete', 'fileFolder', folder.id);
    }
    if (
      !ctx.can('delete', folder.parentId) &&
      (await this.repo.hasItemsNotCreatedBy(folderIds, actor.id, tx))
    ) {
      throw await this.access.deny(actor, 'delete', 'fileFolder', folder.id, 'not-owner');
    }
    const protectedFolder = folderIds.find(
      (folderId) =>
        ctx.folders.get(folderId)?.inheritGrants === false && !ctx.can('delete', folderId),
    );
    if (protectedFolder) {
      throw await this.access.deny(actor, 'delete', 'fileFolder', folder.id, 'protected-subfolder');
    }
  }

  async tagsFor(id: string): Promise<TagSummaryDto[]> {
    return (await this.tags.tagsOf(RESOURCE_TYPE.FILE_FOLDER, [id])).get(id) ?? [];
  }

  publish(changes: ResourceChangeWire[]): void {
    if (changes.length === 0) return;
    this.events.publish(DomainEvent.RESOURCE_CHANGED, { changes });
  }
}

/**
 * 超過資料夾的深度上限：`400 VALIDATION_FAILED`，`details.fields` 標在請求裡對應的欄位，`details.max` 是上限
 * （docs/architecture/backend/03-api-conventions.md §1）。
 */
export function folderDepthExceeded(field: string | undefined): AppException {
  return new AppException('VALIDATION_FAILED', {
    ...(field && {
      fields: { [field]: `exceeds the maximum folder depth of ${MAX_FOLDER_DEPTH}` },
    }),
    max: MAX_FOLDER_DEPTH,
  });
}

/** 上層資料夾已刪除：先還原上層（docs/architecture/backend/14-revisions.md §9.2 D5）。 */
export function folderParentDeleted(parentId: string): AppException {
  return new AppException('FILE_FOLDER_RESTORE_CONFLICT', {
    reason: 'parentDeleted',
    parentType: RESOURCE_TYPE.FILE_FOLDER,
    parentId,
  });
}

/** 系統資料夾（共用、私人、個人）不能改名、移動、刪除（docs/rbac/07-resource-grants.md §12）。 */
export function assertNotSystem(folders: readonly FileFolderRow[]): void {
  const system = folders.filter((folder) => folder.kind !== 'normal');
  if (system.length > 0) {
    throw new AppException('FILE_FOLDER_SYSTEM_PROTECTED', {
      folderIds: system.map((folder) => folder.id),
    });
  }
}

/** 資料夾的回應；能力預設由 `ctx` 推得（剛建立、context 還不認得它的資料夾由呼叫端給）。 */
export function toFolderDto(
  row: FileFolderRow,
  ctx: FileAccessContext,
  tags: TagSummaryDto[],
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
    tags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
