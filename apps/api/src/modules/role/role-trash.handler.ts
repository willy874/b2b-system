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

import { RoleRepository } from './role.repository';

/**
 * 角色的回收桶（ADR-0025 D2、D9、D11）。還原是 `POST /roles/:id/restore`（`RoleService.restore`）；
 * 這裡只負責列出與到期永久刪除。
 */
@Injectable()
export class RoleTrashHandler implements TrashHandler, OnModuleInit {
  readonly type = RESOURCE_TYPE.ROLE;
  readonly permission = PERMISSION.ROLE_DELETE;
  /** 檔案（10）→ 資料夾（20）→ 使用者（30）→ 角色：沒有外鍵參照角色，排在最後只是照 D11 的順序。 */
  readonly purgeOrder = 40;

  constructor(
    private readonly trash: TrashService,
    private readonly repo: RoleRepository,
    private readonly permissionService: PermissionService,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.trash.registerHandler(this);
  }

  async listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }> {
    const { items, total } = await this.repo.listDeleted(query);
    return {
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
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
    const rows = await this.repo.findExpired(cutoff, afterId, limit);
    return rows.map((row) => ({ id: row.id, name: row.name, deletedAt: row.deletedAt }));
  }

  purge(item: ExpiredTrashItem, tx: Transaction): Promise<boolean> {
    return this.repo.hardDelete(item.id, tx);
  }

  async afterPurge(ids: readonly string[]): Promise<void> {
    // 刪掉了休眠的持有者邊、權限鍵與資料夾授權（relation_tuples 的寫入）：已刪除的角色本來就不在解析結果裡，
    // 仍照規則通知一次（docs/architecture/backend/05-rbac.md §5.1）
    await this.permissionService.permissionsChanged();
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: ids.map((id) => ({ resource: ChangeSource.ROLE, kind: ChangeKind.DELETE, id })),
    });
  }
}
