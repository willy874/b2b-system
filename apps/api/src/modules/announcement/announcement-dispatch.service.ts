import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { JobQueue } from '@/core/jobs';
import { SettingService } from '@/core/settings';
import { requireTenant } from '@/core/tenant';
import type { AnnouncementDispatchRow } from '@/db/schema';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';

import { AnnouncementAudienceResolver } from './announcement.audience';
import { ANNOUNCEMENT_FAN_OUT_BATCH_SIZE } from './announcement.constants';
import { ANNOUNCEMENT_FAN_OUT_JOB } from './announcement.job-types';
import type {
  AnnouncementDispatchJobData,
  AnnouncementFanOutJobData,
} from './announcement.job-types';
import {
  ANNOUNCEMENT_PUBLISHED_NOTIFICATION,
  announcementMessageLink,
} from './announcement.notifications';
import { AnnouncementRepository } from './announcement.repository';
import { ANNOUNCEMENT_MAX_RECIPIENTS_SETTING } from './announcement.settings';

/** 一次發送的結果（存成背景工作的 `output`）。 */
export type FanOutReport =
  | { skipped: 'featureDisabled' | 'notFound' | 'alreadyFinished' }
  | { failed: 'tooManyRecipients'; count: number; max: number }
  | { recipients: number; written: number; revoked: boolean };

/**
 * 公告的背景發送（docs/adr/0031-announcements.md D8、D9）。
 *
 * - `runScheduled`：排程時間到的延遲工作。只在公告仍是 `scheduled`、`next_run_at` 等於工作上的時間時建立發送；
 *   編輯、暫停、刪除過的公告，舊工作在這裡自然變成 no-op（不必去佇列取消）。
 * - `fanOut`：解析受眾、每 500 人一個交易呼叫 `notify()`。每一批都鎖住發送紀錄並確認沒有被撤回；
 *   重做時 `notifications(source_id, recipient_id)` 的唯一索引略過已寫的人。
 */
@Injectable()
export class AnnouncementDispatchService {
  private readonly logger = new Logger(AnnouncementDispatchService.name);

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: AnnouncementRepository,
    private readonly audience: AnnouncementAudienceResolver,
    private readonly notifications: NotificationService,
    private readonly settings: SettingService,
    private readonly jobs: JobQueue,
    private readonly events: DomainEventBus,
  ) {}

  async runScheduled(
    data: AnnouncementDispatchJobData,
  ): Promise<{ skipped: string } | { dispatchId: string }> {
    if (!isFeatureEnabled()) return { skipped: 'featureDisabled' };
    const runAt = new Date(data.runAt);
    const dispatch = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.lockActive(data.announcementId, tx);
      if (row?.status !== 'scheduled' || row.nextRunAt?.getTime() !== runAt.getTime()) {
        return undefined;
      }
      const created = await this.repo.insertDispatch(
        {
          announcementId: row.id,
          scheduledFor: runAt,
          title: row.title,
          body: row.body,
          audience: row.audience,
          // 排程的發送沿用最後送出或恢復排程的人（不是系統）：通知的觸發者、發送紀錄都顯示他
          createdBy: row.updatedBy,
        },
        tx,
      );
      // 這一次只有一次（`once`）：發完就完成；週期在 A3 算下一次
      await this.repo.setState(row.id, { status: 'completed', nextRunAt: null }, tx);
      if (created)
        await this.jobs.enqueue(ANNOUNCEMENT_FAN_OUT_JOB, { dispatchId: created.id }, { tx });
      return created;
    });
    if (!dispatch) return { skipped: 'stale' };
    this.publish(data.announcementId);
    return { dispatchId: dispatch.id };
  }

  async fanOut(data: AnnouncementFanOutJobData): Promise<FanOutReport> {
    if (!isFeatureEnabled()) return { skipped: 'featureDisabled' };
    const dispatch = await this.repo.findDispatch(data.dispatchId);
    if (!dispatch) return { skipped: 'notFound' };
    if (dispatch.status !== 'pending' && dispatch.status !== 'sending') {
      return { skipped: 'alreadyFinished' };
    }
    await this.repo.updateDispatch(dispatch.id, {
      status: 'sending',
      startedAt: dispatch.startedAt ?? new Date(),
    });
    this.publish(dispatch.announcementId);

    const [resolved, max] = await Promise.all([
      this.audience.resolve(dispatch.audience),
      this.settings.get(ANNOUNCEMENT_MAX_RECIPIENTS_SETTING),
    ]);
    if (resolved.userIds.length > max) {
      // 不截斷（D6）：誰沒收到會變得不可預期
      const count = resolved.userIds.length;
      await this.finish(dispatch, 'failed', {
        reason: 'tooManyRecipients',
        count,
        max,
        skipped: resolved.skipped,
      });
      this.logger.warn(
        { dispatchId: dispatch.id, count, max },
        '公告的收件人超過上限，這次發送失敗',
      );
      return { failed: 'tooManyRecipients', count, max };
    }

    let written = 0;
    let revoked = false;
    for (let start = 0; start < resolved.userIds.length; start += ANNOUNCEMENT_FAN_OUT_BATCH_SIZE) {
      const batch = resolved.userIds.slice(start, start + ANNOUNCEMENT_FAN_OUT_BATCH_SIZE);
      // oxlint-disable-next-line no-await-in-loop -- 每批一個交易，依序寫入（同時開多個交易沒有好處，還會搶連線）
      const result = await withTransaction(this.db, async (tx) => {
        // 與撤回互斥：撤回提交之後不會再有一批寫進去；這一批先提交的，由撤回在之後刪掉
        const locked = await this.repo.lockDispatch(dispatch.id, tx);
        if (!locked || locked.status === 'revoked') return undefined;
        return this.notifications.notify(
          batch.map((recipientId) =>
            notification(ANNOUNCEMENT_PUBLISHED_NOTIFICATION, {
              recipientId,
              actorId: dispatch.createdBy,
              params: { title: dispatch.title },
              link: announcementMessageLink(dispatch.id),
              sourceId: dispatch.id,
            }),
          ),
          tx,
        );
      });
      if (!result) {
        revoked = true;
        break;
      }
      written += result.length;
    }

    if (!revoked) await this.finish(dispatch, 'sent', { skipped: resolved.skipped });
    return { recipients: resolved.userIds.length, written, revoked };
  }

  /** 收尾：狀態、實際寫入的人數（重做時含之前寫的）、結束時間。撤回中的不覆蓋。 */
  private async finish(
    dispatch: AnnouncementDispatchRow,
    status: 'sent' | 'failed',
    details: Record<string, unknown>,
  ): Promise<void> {
    const stats = await this.notifications.statsBySources([dispatch.id]);
    await withTransaction(this.db, async (tx) => {
      const locked = await this.repo.lockDispatch(dispatch.id, tx);
      if (!locked || locked.status === 'revoked') return;
      await this.repo.updateDispatch(
        dispatch.id,
        {
          status,
          recipientCount: stats.get(dispatch.id)?.total ?? 0,
          details,
          finishedAt: new Date(),
        },
        tx,
      );
    });
    this.publish(dispatch.announcementId);
  }

  private publish(announcementId: string): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: ChangeSource.ANNOUNCEMENT, kind: ChangeKind.UPDATE, id: announcementId },
      ],
    });
  }
}

/** 租戶停用了公告（ADR-0031 D20）：已入列的工作略過，資料保留。 */
function isFeatureEnabled(): boolean {
  return requireTenant().features.includes('announcement');
}
