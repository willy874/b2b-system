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

import { AnnouncementRepository } from './announcement.repository';

/**
 * 公告的回收桶（docs/architecture/backend/19-announcement.md §9.2 D19）。還原是 `POST /announcements/:id/restore`；
 * 這裡只負責列出與到期永久刪除（發送紀錄隨之刪除，通知依自己的保留期清除）。
 */
@Injectable()
export class AnnouncementTrashHandler implements TrashHandler, OnModuleInit {
  readonly type = RESOURCE_TYPE.ANNOUNCEMENT;
  readonly permission = PERMISSION.ANNOUNCEMENT_DELETE;
  readonly feature = 'announcement' as const;
  /** 沒有外鍵參照公告（發送紀錄是 CASCADE）；排在群組（50）之後。 */
  readonly purgeOrder = 60;

  constructor(
    private readonly trash: TrashService,
    private readonly repo: AnnouncementRepository,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.trash.registerHandler(this);
  }

  async listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }> {
    const { items, total } = await this.repo.listDeleted(query);
    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.title,
        description: null,
        deletedAt: item.deletedAt,
        deletedBy: item.deletedBy,
      })),
      total,
    };
  }

  findExpired(cutoff: Date, afterId: string | null, limit: number): Promise<ExpiredTrashItem[]> {
    return this.repo.findExpired(cutoff, afterId, limit);
  }

  purge(item: ExpiredTrashItem, tx: Transaction): Promise<boolean> {
    return this.repo.hardDelete(item.id, tx);
  }

  async afterPurge(ids: readonly string[]): Promise<void> {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: ids.map((id) => ({
        resource: ChangeSource.ANNOUNCEMENT,
        kind: ChangeKind.DELETE,
        id,
      })),
    });
  }
}
