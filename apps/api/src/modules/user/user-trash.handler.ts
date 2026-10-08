import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import { UserCacheService } from '@/core/cache';
import type { Transaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import { CommentService } from '@/modules/comment/comment.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { TagService } from '@/modules/tag/tag.service';
import { TrashService } from '@/modules/trash/trash.service';
import type {
  ExpiredTrashItem,
  TrashHandler,
  TrashItem,
  TrashListQuery,
} from '@/modules/trash/trash.types';

import { UserRepository } from './user.repository';

/**
 * 使用者的回收桶（docs/architecture/backend/14-revisions.md §9.2 D9、D11）。還原是 `POST /users/:id/restore`（`UserService.restore`）；
 * 這裡只負責列出與到期永久刪除。
 */
@Injectable()
export class UserTrashHandler implements TrashHandler, OnModuleInit {
  readonly type = RESOURCE_TYPE.USER;
  readonly permission = PERMISSION.USER_DELETE;
  /** 檔案（10）→ 資料夾（20）→ 使用者 → 角色（40）：使用者擁有的個人資料夾要先清掉。 */
  readonly purgeOrder = 30;

  constructor(
    private readonly trash: TrashService,
    private readonly repo: UserRepository,
    private readonly permissionService: PermissionService,
    private readonly userCache: UserCacheService,
    private readonly events: DomainEventBus,
    private readonly tags: TagService,
    private readonly comments: CommentService,
  ) {}

  onModuleInit(): void {
    this.trash.registerHandler(this);
  }

  async listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }> {
    const { items, total } = await this.repo.listDeleted(query);
    return {
      items: items.map((row) => ({
        id: row.id,
        name: row.displayName,
        description: row.email,
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
    return rows.map((row) => ({ id: row.id, name: row.email, deletedAt: row.deletedAt }));
  }

  async purge(item: ExpiredTrashItem, tx: Transaction): Promise<boolean> {
    if (!(await this.repo.hardDelete(item.id, tx))) return false;
    // 標籤的指派是多型關聯、沒有外鍵：一起清掉（docs/architecture/backend/18-tag.md §7.2 D9）
    await this.tags.removeAllFor(RESOURCE_TYPE.USER, [item.id], tx);
    // 留言與關注同理（docs/architecture/backend/24-comment.md §8.2 D10）
    await this.comments.removeAllFor(RESOURCE_TYPE.USER, [item.id], tx);
    return true;
  }

  async afterPurge(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      this.userCache.invalidate(id);
      this.permissionService.invalidateUser(id);
    }
    // 刪掉了他們持有角色的邊（relation_tuples 的寫入）：已刪除的人本來就不在解析結果裡，
    // 仍照規則通知一次（docs/architecture/backend/05-rbac.md §5.1），推播重算 room
    await this.permissionService.permissionsChanged();
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: ids.map((id) => ({ resource: ChangeSource.USER, kind: ChangeKind.DELETE, id })),
    });
  }
}
