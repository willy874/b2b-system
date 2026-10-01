import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { Transaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import { PermissionService } from '@/modules/permission/permission.service';
import { TrashService } from '@/modules/trash/trash.service';
import type {
  ExpiredTrashItem,
  TrashHandler,
  TrashItem,
  TrashListQuery,
} from '@/modules/trash/trash.types';

import { GroupRepository } from './group.repository';

/**
 * 群組的回收桶（ADR-0025 D2、D9、D11）。還原是 `POST /groups/:id/restore`（`GroupService.restore`）；
 * 這裡只負責列出與到期永久刪除。
 */
@Injectable()
export class GroupTrashHandler implements TrashHandler, OnModuleInit {
  readonly type = RESOURCE_TYPE.GROUP;
  readonly permission = PERMISSION.GROUP_DELETE;
  /** 沒有外鍵參照群組；排在角色（40）之後。 */
  readonly purgeOrder = 50;

  constructor(
    private readonly trash: TrashService,
    private readonly repo: GroupRepository,
    private readonly permissionService: PermissionService,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.trash.registerHandler(this);
  }

  async listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }> {
    return this.repo.listDeleted(query);
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

  async afterPurge(ids: readonly string[]): Promise<void> {
    // 刪掉了休眠的成員邊與持有角色的邊（relation_tuples 的寫入）：照規則通知一次（05-rbac.md §5.1）
    await this.permissionService.permissionsChanged();
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: ids.map((id) => ({ resource: ChangeSource.GROUP, kind: ChangeKind.DELETE, id })),
    });
  }
}
