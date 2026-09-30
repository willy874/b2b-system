import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { Transaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import { TrashService } from '@/modules/trash/trash.service';
import type {
  ExpiredTrashItem,
  TrashHandler,
  TrashItem,
  TrashListQuery,
} from '@/modules/trash/trash.types';

import { FileFolderRepository } from './file-folder.repository';
import { FileObjectsService } from './file-objects.service';
import { folderPathOf } from './file.constants';
import { FileRepository } from './file.repository';

/** 永久刪除後同時刪物件的檔案數（每個檔案最多三個請求，含一次列出變體）。 */
const OBJECT_DELETE_CONCURRENCY = 16;

/**
 * 檔案的回收桶（ADR-0025 D5、D9、D11；docs/architecture/backend/13-trash.md §7）。還原是 `POST /files/:id/restore`
 * （`FileService.restore`）；這裡只負責列出與到期永久刪除。
 */
@Injectable()
export class FileTrashHandler implements TrashHandler, OnModuleInit {
  readonly type = RESOURCE_TYPE.FILE;
  /** 回收桶看的是全域的 `file:delete`：只有資料夾層級刪除權的人由刪除提示的「復原」還原（13-trash.md §7.4）。 */
  readonly permission = PERMISSION.FILE_DELETE;
  /** 租戶停用檔案功能時看不到這一類的回收桶（`GET /trash` 回 `FEATURE_DISABLED`，與檔案端點的 `@RequireFeature('file')` 一致）。 */
  readonly feature = 'file' as const;
  /** 最先：`files.folder_id` 是 `RESTRICT`，資料夾（20）要等檔案清掉才刪得掉。 */
  readonly purgeOrder = 10;

  constructor(
    private readonly trash: TrashService,
    private readonly repo: FileRepository,
    private readonly folders: FileFolderRepository,
    private readonly objects: FileObjectsService,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.trash.registerHandler(this);
  }

  /** 個別刪除的檔案；`description` 是原本所在的資料夾路徑（跟著資料夾一起刪的只列資料夾）。 */
  async listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }> {
    const { items, total } = await this.repo.listDeleted(query);
    const paths = await this.folders.findPaths(
      items.flatMap((row) => (row.folderId ? [row.folderId] : [])),
    );
    return {
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        description: folderPathOf(row.folderId ? paths.get(row.folderId) : []),
        deletedAt: row.deletedAt,
        deletedBy: row.deletedBy,
      })),
      total,
    };
  }

  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<ExpiredTrashItem[]> {
    return this.repo.findExpired(cutoff, afterId, limit);
  }

  purge(item: ExpiredTrashItem, tx: Transaction): Promise<boolean> {
    return this.repo.hardDelete(item.id, tx);
  }

  /**
   * 紀錄刪掉之後才刪物件（交易 rollback 時紀錄還在，內容也要在）。刪除失敗只記 warn：
   * 查不到任何紀錄的物件由維護排程的孤兒對帳清掉（09-file.md §9）。
   */
  async afterPurge(ids: readonly string[]): Promise<void> {
    for (let start = 0; start < ids.length; start += OBJECT_DELETE_CONCURRENCY) {
      // oxlint-disable-next-line no-await-in-loop -- 一批刪完再刪下一批，限制同時的請求數
      await Promise.all(
        ids.slice(start, start + OBJECT_DELETE_CONCURRENCY).map((id) => this.objects.deleteAll(id)),
      );
    }
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: ids.map((id) => ({ resource: ChangeSource.FILE, kind: ChangeKind.DELETE, id })),
    });
  }
}
