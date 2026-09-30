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
import { folderPathOf } from './file.constants';

/**
 * 資料夾的回收桶（ADR-0025 D5、D9、D11；docs/architecture/backend/13-trash.md §7）。還原是
 * `POST /file-folders/:id/restore`（`FileFolderService.restore`）；這裡只負責列出與到期永久刪除。
 */
@Injectable()
export class FileFolderTrashHandler implements TrashHandler, OnModuleInit {
  readonly type = RESOURCE_TYPE.FILE_FOLDER;
  /** 與檔案相同：全域的 `file:delete`（13-trash.md §7.4）。 */
  readonly permission = PERMISSION.FILE_DELETE;
  /** 租戶停用檔案功能時看不到這一類的回收桶（`GET /trash` 回 `FEATURE_DISABLED`，與檔案端點的 `@RequireFeature('file')` 一致）。 */
  readonly feature = 'file' as const;
  /**
   * 檔案（10）之後、使用者（30）之前：資料夾裡的檔案要先清掉（`files.folder_id` 是 `RESTRICT`）；
   * 系統刪除的個人資料夾清掉之後，擁有者才能被永久刪除（`file_folders.owner_id` 是 `RESTRICT`）。
   */
  readonly purgeOrder = 20;

  constructor(
    private readonly trash: TrashService,
    private readonly repo: FileFolderRepository,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.trash.registerHandler(this);
  }

  /** 每一批刪除的根；`description` 是原本所在的上層路徑。 */
  async listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }> {
    const { items, total } = await this.repo.listDeleted(query);
    const paths = await this.repo.findPaths(
      items.flatMap((row) => (row.parentId ? [row.parentId] : [])),
    );
    return {
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        description: folderPathOf(row.parentId ? paths.get(row.parentId) : []),
        deletedAt: row.deletedAt,
        deletedBy: row.deletedBy,
      })),
      total,
    };
  }

  /** 到期子樹的根；子孫由 `purge` 一起刪（`FileFolderRepository.findExpired`）。 */
  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<ExpiredTrashItem[]> {
    return this.repo.findExpired(cutoff, afterId, limit);
  }

  async purge(item: ExpiredTrashItem, tx: Transaction): Promise<boolean> {
    return (await this.repo.purgeTree(item.id, tx)).length > 0;
  }

  /**
   * 刪掉的資料夾本來就不在結構裡（快取不必失效）；授權的邊由 `relation_tuples` 的 trigger 讓 revision +1，
   * 資料夾授權不在權限快取裡，不必 `permissionsChanged()`（09-file.md §11）。只通知回收桶重抓。
   */
  async afterPurge(ids: readonly string[]): Promise<void> {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: ids.map((id) => ({
        resource: ChangeSource.FILE_FOLDER,
        kind: ChangeKind.DELETE,
        id,
      })),
    });
  }
}
