import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { JobQueue } from '@/core/jobs';
import { SettingService } from '@/core/settings';
import { requireTenant } from '@/core/tenant';
import type { AnnouncementAudienceValue, AnnouncementDispatchRow } from '@/db/schema';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';

import { AnnouncementTriggerCatalog } from './announcement-trigger.catalog';
import { AnnouncementAudienceResolver } from './announcement.audience';
import {
  ANNOUNCEMENT_FAN_OUT_BATCH_SIZE,
  ANNOUNCEMENT_REQUEUE_WINDOW_MS,
} from './announcement.constants';
import { ANNOUNCEMENT_FAN_OUT_JOB } from './announcement.job-types';
import type {
  AnnouncementDispatchJobData,
  AnnouncementEventDispatchJobData,
  AnnouncementFanOutJobData,
} from './announcement.job-types';
import {
  ANNOUNCEMENT_PUBLISHED_NOTIFICATION,
  announcementMessageLink,
} from './announcement.notifications';
import { AnnouncementRepository } from './announcement.repository';
import { AnnouncementScheduler } from './announcement.scheduler';
import {
  ANNOUNCEMENT_DISPATCH_RETENTION_DAYS_SETTING,
  ANNOUNCEMENT_MAX_RECIPIENTS_SETTING,
} from './announcement.settings';
import type { AnnouncementTriggerScope } from './announcement.triggers';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 保留清理一批刪幾筆：一批一條 DELETE（各自提交）。 */
const CLEANUP_BATCH_SIZE = 500;

/** 每日維護的結果（存成背景工作的 `output`）。 */
export type MaintenanceReport =
  | { skipped: 'featureDisabled' }
  | { rescheduled: number; requeued: number; retentionDays: number; deletedDispatches: number };

/** 一次發送的結果（存成背景工作的 `output`）。 */
export type FanOutReport =
  | { skipped: 'featureDisabled' | 'notFound' | 'alreadyFinished' }
  | { failed: 'tooManyRecipients'; count: number; max: number }
  | { recipients: number; written: number; revoked: boolean };

/**
 * 公告的背景發送（docs/adr/0031-announcements.md D8、D9）。
 *
 * - `runScheduled`：排程時間到的延遲工作。只在公告仍是 `scheduled`、`next_run_at` 等於工作上的時間時建立發送；
 *   編輯、暫停、刪除過的公告，舊工作在這裡自然變成 no-op（不必去佇列取消）。週期的算出下一次並入列，沒有了就完成。
 * - `runEvent`：事件點的發送（一個人一筆）。
 * - `maintain`：每日維護（補排程、發送紀錄的保留清理）。
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
    private readonly scheduler: AnnouncementScheduler,
    private readonly triggers: AnnouncementTriggerCatalog,
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
      // 下一次從「這一次」與「現在」較晚的那一刻算起：停機後補發的這一次之外，中間錯過的不連發（D10）
      const after = new Date(Math.max(runAt.getTime(), Date.now()));
      const next = await this.scheduler.nextRun(
        row.trigger,
        after,
        await this.repo.countDispatches(row.id, tx),
      );
      await this.repo.setState(
        row.id,
        next ? { status: 'scheduled', nextRunAt: next } : { status: 'completed', nextRunAt: null },
        tx,
      );
      if (next) await this.scheduler.enqueue(row.id, next, tx);
      if (created)
        await this.jobs.enqueue(ANNOUNCEMENT_FAN_OUT_JOB, { dispatchId: created.id }, { tx });
      return created;
    });
    if (!dispatch) return { skipped: 'stale' };
    this.publish(data.announcementId);
    return { dispatchId: dispatch.id };
  }

  /**
   * 每日維護（D10、D19）：
   * - 補排程：排程中的公告重算下一次（改了租戶時區、或延遲工作遺失）；與存的不同就更新並入列，
   *   下一次在維護間隔內（含已經過了）的再入列一筆——重複的工作在執行時發現對不上就略過，不會重發。
   * - 保留清理：刪除建立超過 `announcement.dispatchRetentionDays` 天、已經結束的發送紀錄。
   */
  async maintain(now: Date = new Date()): Promise<MaintenanceReport> {
    if (!isFeatureEnabled()) return { skipped: 'featureDisabled' };
    let rescheduled = 0;
    let requeued = 0;
    for (const row of await this.repo.listScheduled()) {
      // oxlint-disable-next-line no-await-in-loop -- 每則一個短交易；排程中的公告不多
      const outcome = await this.reconcile(row.id, now);
      if (outcome === 'rescheduled') rescheduled += 1;
      if (outcome !== 'unchanged') requeued += 1;
    }
    const retentionDays = await this.settings.get(ANNOUNCEMENT_DISPATCH_RETENTION_DAYS_SETTING);
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    let deletedDispatches = 0;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 分批刪除，下一批要等這一批提交
      const count = await this.repo.deleteFinishedDispatchesBefore(cutoff, CLEANUP_BATCH_SIZE);
      deletedDispatches += count;
      if (count < CLEANUP_BATCH_SIZE) break;
    }
    const report = { rescheduled, requeued, retentionDays, deletedDispatches };
    this.logger.log(report, '公告的每日維護完成');
    return report;
  }

  /** 一則排程中的公告：重算下一次，必要時更新並入列。 */
  private async reconcile(
    id: string,
    now: Date,
  ): Promise<'unchanged' | 'requeued' | 'rescheduled'> {
    const outcome = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.lockActive(id, tx);
      // 事件點沒有時間表：只在事件發生時入列
      if (row?.status !== 'scheduled' || row.trigger.kind === 'event') return 'unchanged' as const;
      const stored = row.nextRunAt;
      // 指定時間只有一次：已經過了也照存的時間補發（延遲工作遺失）；週期依目前的時區重算
      const expected =
        row.trigger.kind === 'recurring'
          ? await this.scheduler.nextRun(
              row.trigger,
              new Date(Math.min(now.getTime(), stored?.getTime() ?? now.getTime()) - 1),
              await this.repo.countDispatches(row.id, tx),
            )
          : stored;
      if (!expected) {
        await this.repo.setState(row.id, { status: 'completed', nextRunAt: null }, tx);
        return 'rescheduled' as const;
      }
      if (expected.getTime() !== stored?.getTime()) {
        await this.repo.setState(row.id, { status: 'scheduled', nextRunAt: expected }, tx);
        await this.scheduler.enqueue(row.id, expected, tx);
        return 'rescheduled' as const;
      }
      if (expected.getTime() - now.getTime() > ANNOUNCEMENT_REQUEUE_WINDOW_MS) {
        return 'unchanged' as const;
      }
      await this.scheduler.enqueue(row.id, expected, tx);
      return 'requeued' as const;
    });
    if (outcome === 'rescheduled') this.publish(id);
    return outcome;
  }

  /**
   * 事件點的發送（D12、D13）：公告仍是排程中、還訂著這個觸發點，而且事件的使用者在受眾裡（依觸發點的比對方式）時，
   * 建立只發給他的發送紀錄並入列分批寫入。同一則公告對同一個人只有一筆（唯一索引），事件重複發生不會重發。
   */
  async runEvent(
    data: AnnouncementEventDispatchJobData,
  ): Promise<{ skipped: string } | { dispatchId: string }> {
    if (!isFeatureEnabled()) return { skipped: 'featureDisabled' };
    const definition = this.triggers.find(data.event);
    if (!definition) return { skipped: 'unknownEvent' };
    const dispatch = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.lockActive(data.announcementId, tx);
      if (
        row?.status !== 'scheduled' ||
        row.trigger.kind !== 'event' ||
        row.trigger.event !== data.event
      ) {
        return 'stale' as const;
      }
      if (!(await this.matches(definition.scope, row.audience, data)))
        return 'notInAudience' as const;
      const created = await this.repo.insertDispatch(
        {
          announcementId: row.id,
          scheduledFor: new Date(data.runAt),
          title: row.title,
          body: row.body,
          audience: { all: false, userIds: [data.userId], groupIds: [], roleIds: [] },
          triggerSubjectId: data.userId,
          createdBy: row.updatedBy,
        },
        tx,
      );
      if (!created) return 'alreadySent' as const;
      await this.jobs.enqueue(ANNOUNCEMENT_FAN_OUT_JOB, { dispatchId: created.id }, { tx });
      return created;
    });
    if (typeof dispatch === 'string') return { skipped: dispatch };
    this.publish(data.announcementId);
    return { dispatchId: dispatch.id };
  }

  /** 事件的使用者在不在公告的受眾裡（D13、D14）。 */
  private async matches(
    scope: AnnouncementTriggerScope,
    audience: AnnouncementAudienceValue,
    data: AnnouncementEventDispatchJobData,
  ): Promise<boolean> {
    if (audience.all) return true;
    switch (scope) {
      case 'group':
        return data.groupId !== undefined && audience.groupIds.includes(data.groupId);
      case 'role':
        return (data.roleIds ?? []).some((roleId) => audience.roleIds.includes(roleId));
      case 'audience':
        return (await this.audience.resolve(audience)).userIds.includes(data.userId);
    }
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
