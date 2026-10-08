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

import { OrgUnitRepository } from './org-unit.repository';

/**
 * 部門的回收桶。還原是 `POST /org-units/:id/restore`（`OrgUnitService.restore`）；這裡只負責列出與到期永久刪除。
 * 還有下層的部門這一輪略過（`parent_id` 是 RESTRICT），下層先被刪掉後下一輪再處理。
 */
@Injectable()
export class OrgUnitTrashHandler implements TrashHandler, OnModuleInit {
  readonly type = RESOURCE_TYPE.ORG_UNIT;
  readonly permission = PERMISSION.ORG_UNIT_DELETE;
  readonly feature = 'organization' as const;
  /** 成員資格隨外鍵 CASCADE；排在使用者（30）之前，免得使用者的永久刪除還要等它。 */
  readonly purgeOrder = 25;

  constructor(
    private readonly trash: TrashService,
    private readonly repo: OrgUnitRepository,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.trash.registerHandler(this);
  }

  listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }> {
    return this.repo.listDeleted(query);
  }

  findExpired(cutoff: Date, afterId: string | null, limit: number): Promise<ExpiredTrashItem[]> {
    return this.repo.findExpired(cutoff, afterId, limit);
  }

  purge(item: ExpiredTrashItem, tx: Transaction): Promise<boolean> {
    return this.repo.hardDelete(item.id, tx);
  }

  async afterPurge(ids: readonly string[]): Promise<void> {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: ids.map((id) => ({ resource: ChangeSource.ORG_UNIT, kind: ChangeKind.DELETE, id })),
    });
  }
}
