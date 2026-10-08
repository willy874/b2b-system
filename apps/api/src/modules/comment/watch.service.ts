import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { JobQueue } from '@/core/jobs';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';

import { WATCH_RESOURCE_UPDATED_NOTIFICATION } from './comment.notifications';
import { CommentResourceRegistry } from './comment.registry';
import type { WatchStateDto } from './dto/watch.dto';
import { WATCH_NOTIFY_JOB } from './watch.job-types';
import type { WatchNotifyJobData } from './watch.job-types';
import { WatchRepository } from './watch.repository';

/** 同一個資源被連續修改時，這麼多秒內只通知一次（docs/architecture/backend/24-comment.md §8.2 D9）。 */
export const WATCH_NOTIFY_THROTTLE_SECONDS = 60;

/** 擁有者宣告「這個資源被修改了」（`WatchService.resourceChanged`）。 */
export interface WatchedResourceChange {
  resourceType: string;
  resourceId: string;
  /** 修改的人；不通知他自己。null＝系統。 */
  actorId: string | null;
}

/**
 * 關注（docs/architecture/backend/24-comment.md §3.2、§4）：看得到資源就能關注；有新留言時由 `CommentService` 通知，
 * 資源被修改時由擁有者在業務交易內呼叫 `resourceChanged()`，背景工作送出通知（D9）。
 */
@Injectable()
export class WatchService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: WatchRepository,
    private readonly registry: CommentResourceRegistry,
    private readonly notifications: NotificationService,
    private readonly jobs: JobQueue,
    private readonly events: DomainEventBus,
  ) {}

  // ── 端點 ─────────────────────────────────────────────

  async state(resourceType: string, resourceId: string, actor: AuthUser): Promise<WatchStateDto> {
    await this.registry.require(resourceType).resolveViewable(actor, resourceId, {
      route: 'GET /watches/:resourceType/:resourceId',
      metadata: { resourceType, resourceId },
    });
    return this.repo.state(resourceType, resourceId, actor.id);
  }

  async watch(resourceType: string, resourceId: string, actor: AuthUser): Promise<WatchStateDto> {
    await this.registry.require(resourceType).resolveViewable(actor, resourceId, {
      route: 'PUT /watches/:resourceType/:resourceId',
      metadata: { resourceType, resourceId },
    });
    if (await this.repo.watch(resourceType, resourceId, actor.id)) {
      this.publishWatchChanged(actor.id, resourceId);
    }
    return this.repo.state(resourceType, resourceId, actor.id);
  }

  /** 取消關注不檢查看不看得到：失去權限的人也要能把它拿掉。 */
  async unwatch(resourceType: string, resourceId: string, actor: AuthUser): Promise<WatchStateDto> {
    this.registry.require(resourceType);
    if (await this.repo.unwatch(resourceType, resourceId, actor.id)) {
      this.publishWatchChanged(actor.id, resourceId);
    }
    return this.repo.state(resourceType, resourceId, actor.id);
  }

  // ── 給擁有者 ─────────────────────────────────────────

  /**
   * 資源被修改：在擁有者的業務交易內呼叫。有人關注時入列一筆通知工作（與資料一起提交或回滾）；
   * 同一個資源 60 秒內只入列一次。收件人與名稱在工作執行時才算，不佔用業務交易的時間。
   */
  async resourceChanged(change: WatchedResourceChange, tx: Transaction): Promise<void> {
    if (!(await this.repo.hasWatchers(change.resourceType, change.resourceId, tx))) return;
    await this.jobs.enqueue(WATCH_NOTIFY_JOB, change, {
      tx,
      throttle: {
        key: `${change.resourceType}:${change.resourceId}`,
        seconds: WATCH_NOTIFY_THROTTLE_SECONDS,
      },
    });
  }

  // ── 給 CommentService ────────────────────────────────

  watcherIds(resourceType: string, resourceId: string): Promise<string[]> {
    return this.repo.watcherIds(resourceType, resourceId);
  }

  /** 留言的作者自動關注（D8）；回傳是不是這次才開始關注。 */
  watchInTx(
    resourceType: string,
    resourceId: string,
    userId: string,
    tx: Transaction,
  ): Promise<boolean> {
    return this.repo.watch(resourceType, resourceId, userId, tx);
  }

  removeAllFor(resourceType: string, resourceIds: readonly string[], tx: DbOrTx): Promise<void> {
    return this.repo.removeAllFor(resourceType, resourceIds, tx);
  }

  /** 只推給本人：其他分頁的「關注」按鈕跟著更新。 */
  publishWatchChanged(userId: string, resourceId: string): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.WATCH, kind: ChangeKind.UPDATE, id: resourceId }],
      affectedUserIds: [userId],
    });
  }

  // ── 背景工作 ─────────────────────────────────────────

  /**
   * `watch.notify`：通知關注者（不含修改的人）。擁有者已下線、feature 沒啟用、資源已不存在時略過；
   * 收件人只留看得到資源的人。
   */
  async notifyWatchers(
    data: WatchNotifyJobData,
  ): Promise<{ notified: number } | { skipped: string }> {
    const definition = this.registry.find(data.resourceType);
    if (!definition) return { skipped: 'RESOURCE_TYPE_UNAVAILABLE' };
    const target = await definition.describe(data.resourceId);
    if (!target) return { skipped: 'RESOURCE_NOT_FOUND' };
    const watcherIds = (await this.repo.watcherIds(data.resourceType, data.resourceId)).filter(
      (id) => id !== data.actorId,
    );
    const recipients = await definition.filterViewers(data.resourceId, watcherIds);
    if (!recipients.length) return { notified: 0 };

    await withTransaction(this.db, (tx) =>
      this.notifications.notify(
        recipients.map((recipientId) =>
          notification(WATCH_RESOURCE_UPDATED_NOTIFICATION, {
            recipientId,
            actorId: data.actorId,
            params: { resourceType: data.resourceType, resourceName: target.name },
            link: target.link,
          }),
        ),
        tx,
      ),
    );
    return { notified: recipients.length };
  }
}
