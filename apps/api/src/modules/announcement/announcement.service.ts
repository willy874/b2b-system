import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import type { Database, MissedUpdateCodes } from '@/core/database';
import { missedUpdate, TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import { JobQueue } from '@/core/jobs';
import { RESOURCE_TYPE } from '@/core/resource';
import { requireTenant } from '@/core/tenant';
import type {
  AnnouncementDispatchRow,
  AnnouncementRow,
  AnnouncementTriggerValue,
} from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { NotificationService } from '@/modules/notification/notification.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { AnnouncementTriggerCatalog } from './announcement-trigger.catalog';
import { AnnouncementAudienceResolver, isEmptyAudience } from './announcement.audience';
import { ANNOUNCEMENT_RECURRENCE_PREVIEW_COUNT } from './announcement.constants';
import { ANNOUNCEMENT_FAN_OUT_JOB } from './announcement.job-types';
import type { AnnouncementWithPeople, DispatchWithPeople } from './announcement.repository';
import { AnnouncementRepository } from './announcement.repository';
import { AnnouncementScheduler } from './announcement.scheduler';
import type { AnnouncementTriggerScope } from './announcement.triggers';
import type {
  AnnouncementActionDto,
  AnnouncementAudienceDto,
  AnnouncementDispatchDto,
  AnnouncementDto,
  AnnouncementMessageDto,
  AudiencePreviewDto,
  CreateAnnouncementDto,
  ListAnnouncementDispatchDto,
  ListAnnouncementDto,
  RecurrencePreviewDto,
  RecurrencePreviewRequestDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

type DispatchStats = Map<string, { total: number; read: number }>;

function toDto(
  row: AnnouncementWithPeople,
  last: AnnouncementDispatchRow | undefined,
  stats: DispatchStats,
): AnnouncementDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    trigger: row.trigger,
    status: row.status,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastDispatch: last
      ? {
          id: last.id,
          status: last.status,
          scheduledFor: last.scheduledFor.toISOString(),
          recipientCount: last.recipientCount,
          readCount: stats.get(last.id)?.read ?? 0,
        }
      : null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.creator,
    updatedBy: row.updater,
  };
}

function toDispatchDto(row: DispatchWithPeople, stats: DispatchStats): AnnouncementDispatchDto {
  return {
    id: row.id,
    announcementId: row.announcementId,
    scheduledFor: row.scheduledFor.toISOString(),
    title: row.title,
    body: row.body,
    audience: row.audience,
    status: row.status,
    recipientCount: row.recipientCount,
    readCount: stats.get(row.id)?.read ?? 0,
    details: row.details ?? null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdBy: row.creator,
    revokedBy: row.revoker,
  };
}

/** 稽核用的快照：內文可能很長，只記長度。 */
function auditSnapshot(row: Pick<AnnouncementRow, 'title' | 'body' | 'audience' | 'trigger'>) {
  return {
    title: row.title,
    bodyLength: row.body.length,
    audience: row.audience,
    trigger: row.trigger,
  };
}

/**
 * 公告（docs/architecture/backend/19-announcement.md §9）。
 *
 * 狀態：`draft` →（送出）→ 立即：建立發送後 `completed`；指定時間：`scheduled` →（時間到）→ `completed`。
 * `scheduled` ⇄ `paused`（暫停、恢復）。草稿以外的公告會對外發話，修改要 `announcement:publish`（D15）。
 * 排程是延遲工作（D8）：狀態或時間變了，舊的工作在執行時發現對不上就略過。
 */
/** 樂觀鎖的條件式 UPDATE 沒命中時的錯誤碼（`missedUpdate`）。 */
const ANNOUNCEMENT_LOCK_CODES = {
  notFound: 'ANNOUNCEMENT_NOT_FOUND',
  conflict: 'ANNOUNCEMENT_VERSION_CONFLICT',
} as const satisfies MissedUpdateCodes;

@Injectable()
export class AnnouncementService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: AnnouncementRepository,
    private readonly audience: AnnouncementAudienceResolver,
    private readonly notifications: NotificationService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly jobs: JobQueue,
    private readonly scheduler: AnnouncementScheduler,
    private readonly triggers: AnnouncementTriggerCatalog,
    private readonly events: DomainEventBus,
  ) {}

  async list(query: ListAnnouncementDto) {
    const { items, total } = await this.repo.list(query);
    const latest = await this.repo.latestDispatches(items.map((item) => item.id));
    const byAnnouncement = new Map(latest.map((row) => [row.announcementId, row]));
    const stats = await this.notifications.statsBySources(latest.map((row) => row.id));
    return paginated(
      items.map((item) => toDto(item, byAnnouncement.get(item.id), stats)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<AnnouncementDto> {
    const row = await this.repo.findWithPeople(id);
    if (!row) throw new AppException('ANNOUNCEMENT_NOT_FOUND');
    const [last] = await this.repo.latestDispatches([id]);
    const stats = await this.notifications.statsBySources(last ? [last.id] : []);
    return toDto(row, last, stats);
  }

  async create(dto: CreateAnnouncementDto, actor: AuthUser): Promise<AnnouncementDto> {
    this.assertKnownEvent(dto.trigger);
    const created = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.create(
        {
          title: dto.title,
          body: dto.body,
          audience: dto.audience,
          trigger: dto.trigger,
          status: 'draft',
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'announcement.create',
          resourceType: RESOURCE_TYPE.ANNOUNCEMENT,
          resourceId: row.id,
          resourceName: row.title,
          changes: { after: auditSnapshot(row) },
        },
        tx,
      );
      return row;
    });
    this.publish(ChangeKind.CREATE, created.id);
    return this.findOne(created.id);
  }

  /**
   * 編輯。草稿只要 `announcement:update`；排程中、暫停中的會對外發話，另要 `announcement:publish`。
   * 已完成的不能改（要再發一次就建立新的公告）。排程中改了時間：重算並入列新的延遲工作，舊的變成 no-op。
   * 只影響之後的發送：已發出的內容是發送紀錄的快照（D17）。
   */
  async update(id: string, dto: UpdateAnnouncementDto, actor: AuthUser): Promise<AnnouncementDto> {
    const { version, ...fields } = dto;
    const current = await this.getExisting(id);
    if (version !== current.version) {
      throw new AppException('ANNOUNCEMENT_VERSION_CONFLICT', { current: current.version });
    }
    if (current.status === 'completed') {
      throw new AppException('ANNOUNCEMENT_INVALID_STATE', { status: current.status });
    }
    if (current.status !== 'draft') await this.assertCanPublish(actor, id);
    const trigger = fields.trigger ?? current.trigger;
    // 排程中、暫停中的公告已經送出過：只能改成另一個時間，不能改成「立即」（要立即發送就建立新的公告）
    if (current.status !== 'draft' && trigger.kind === 'immediate') {
      throw new AppException('ANNOUNCEMENT_INVALID_STATE', { status: current.status });
    }
    this.assertKnownEvent(trigger);
    const reschedule =
      current.status === 'scheduled' &&
      fields.trigger !== undefined &&
      trigger.kind !== 'immediate';
    // 改成事件點：沒有時間表，`next_run_at` 清空（舊的延遲工作在執行時對不上就略過）
    const schedule = reschedule
      ? await this.scheduler.scheduledState(trigger, await this.repo.countDispatches(id))
      : undefined;
    const runAt = schedule?.nextRunAt ?? undefined;

    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(
        id,
        {
          ...fields,
          ...(schedule && { nextRunAt: schedule.nextRunAt }),
          updatedBy: actor.id,
        },
        version,
        tx,
      );
      if (!updated)
        throw await missedUpdate(() => this.repo.findVersion(id, tx), ANNOUNCEMENT_LOCK_CODES);
      if (runAt) await this.scheduler.enqueue(id, runAt, tx);
      await this.audit.record(
        {
          action: 'announcement.update',
          resourceType: RESOURCE_TYPE.ANNOUNCEMENT,
          resourceId: id,
          resourceName: updated.title,
          changes: { before: auditSnapshot(current), after: auditSnapshot(updated) },
          metadata: { status: updated.status },
        },
        tx,
      );
    });
    this.publish(ChangeKind.UPDATE, id);
    return this.findOne(id);
  }

  /** 送出草稿：立即發送，或進入排程（D8）。受眾不能是空的；指定的時間必須在未來。 */
  async publishAnnouncement(
    id: string,
    dto: AnnouncementActionDto,
    actor: AuthUser,
  ): Promise<AnnouncementDto> {
    const current = await this.getExisting(id);
    this.assertVersion(current, dto.version);
    if (current.status !== 'draft') {
      throw new AppException('ANNOUNCEMENT_INVALID_STATE', { status: current.status });
    }
    if (isEmptyAudience(current.audience)) throw new AppException('ANNOUNCEMENT_AUDIENCE_EMPTY');
    this.assertKnownEvent(current.trigger);
    // 立即：沒有排程，直接建立發送；其他（指定時間、週期、事件點）進入排程
    const schedule =
      current.trigger.kind === 'immediate'
        ? undefined
        : await this.scheduler.scheduledState(current.trigger, 0);

    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(
        id,
        schedule
          ? { ...schedule, updatedBy: actor.id }
          : { status: 'completed', nextRunAt: null, updatedBy: actor.id },
        dto.version,
        tx,
      );
      if (!updated)
        throw await missedUpdate(() => this.repo.findVersion(id, tx), ANNOUNCEMENT_LOCK_CODES);
      let dispatchId: string | undefined;
      if (schedule) {
        if (schedule.nextRunAt) await this.scheduler.enqueue(id, schedule.nextRunAt, tx);
      } else {
        const dispatch = await this.repo.insertDispatch(
          {
            announcementId: id,
            scheduledFor: new Date(),
            title: updated.title,
            body: updated.body,
            audience: updated.audience,
            createdBy: actor.id,
          },
          tx,
        );
        if (!dispatch) throw new Error('立即發送沒有建立發送紀錄');
        dispatchId = dispatch.id;
        await this.jobs.enqueue(ANNOUNCEMENT_FAN_OUT_JOB, { dispatchId }, { tx });
      }
      await this.audit.record(
        {
          action: 'announcement.publish',
          resourceType: RESOURCE_TYPE.ANNOUNCEMENT,
          resourceId: id,
          resourceName: updated.title,
          changes: { after: auditSnapshot(updated) },
          metadata: { trigger: updated.trigger, ...(dispatchId && { dispatchId }) },
        },
        tx,
      );
    });
    this.publish(ChangeKind.UPDATE, id);
    return this.findOne(id);
  }

  /** 暫停排程：`scheduled` → `paused`，已入列的延遲工作在執行時略過。 */
  async pause(id: string, dto: AnnouncementActionDto, actor: AuthUser): Promise<AnnouncementDto> {
    return this.transition(id, dto, actor, {
      from: 'scheduled',
      action: 'announcement.pause',
      values: async () => ({ status: 'paused', nextRunAt: null }),
    });
  }

  /**
   * 恢復排程：`paused` → `scheduled`，從現在起重算下一次並入列（暫停期間錯過的不補發）；
   * 指定的時間已經過去、週期已結束就不能恢復。
   */
  async resume(id: string, dto: AnnouncementActionDto, actor: AuthUser): Promise<AnnouncementDto> {
    return this.transition(id, dto, actor, {
      from: 'paused',
      action: 'announcement.resume',
      values: async (row) => {
        // 只有排程過的公告會被暫停，不會是「立即」
        if (row.trigger.kind === 'immediate') {
          throw new AppException('ANNOUNCEMENT_INVALID_STATE', { status: row.status });
        }
        return this.scheduler.scheduledState(row.trigger, await this.repo.countDispatches(row.id));
      },
    });
  }

  /** 軟刪除（進回收桶，D19）；排程中的改成暫停，還原後不會自己開始發。 */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const current = await this.getExisting(id);
    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.lockActive(id, tx))) throw new AppException('ANNOUNCEMENT_NOT_FOUND');
      await this.repo.softDelete(id, actor.id, tx);
      await this.audit.record(
        {
          action: 'announcement.delete',
          resourceType: RESOURCE_TYPE.ANNOUNCEMENT,
          resourceId: id,
          resourceName: current.title,
          changes: { before: { title: current.title, status: current.status } },
        },
        tx,
      );
    });
    this.publish(ChangeKind.DELETE, id);
  }

  async restore(id: string, actor: AuthUser): Promise<AnnouncementDto> {
    const deleted = await this.repo.findDeletedById(id);
    if (!deleted) {
      throw new AppException(
        (await this.repo.exists(id)) ? 'ANNOUNCEMENT_NOT_DELETED' : 'ANNOUNCEMENT_NOT_FOUND',
      );
    }
    await withTransaction(this.db, async (tx) => {
      const row = await this.repo.restore(id, actor.id, tx);
      // 檢查之後被別人搶先還原
      if (!row) throw new AppException('ANNOUNCEMENT_NOT_DELETED');
      await this.audit.record(
        {
          action: 'announcement.restore',
          resourceType: RESOURCE_TYPE.ANNOUNCEMENT,
          resourceId: id,
          resourceName: row.title,
          changes: { after: { title: row.title, status: row.status } },
          metadata: { deletedAt: deleted.deletedAt?.toISOString() },
        },
        tx,
      );
    });
    // 重新出現在列表：以 create 宣告（與群組的還原相同）
    this.publish(ChangeKind.CREATE, id);
    return this.findOne(id);
  }

  /** 週期的預覽：接下來最多 5 次（租戶時區），前端不自己算（D11）。 */
  async previewRecurrence(dto: RecurrencePreviewRequestDto): Promise<RecurrencePreviewDto> {
    const { timeZone, occurrences } = await this.scheduler.preview(
      dto.trigger,
      ANNOUNCEMENT_RECURRENCE_PREVIEW_COUNT,
    );
    return { timeZone, occurrences: occurrences.map((at) => at.toISOString()) };
  }

  async previewAudience(audience: AnnouncementAudienceDto): Promise<AudiencePreviewDto> {
    const resolved = await this.audience.resolve(audience);
    return { count: resolved.userIds.length, skipped: resolved.skipped };
  }

  async listDispatches(id: string, query: ListAnnouncementDispatchDto) {
    await this.getExisting(id);
    const { items, total } = await this.repo.listDispatches(id, query.offset, query.limit);
    const stats = await this.notifications.statsBySources(items.map((item) => item.id));
    return paginated(
      items.map((item) => toDispatchDto(item, stats)),
      total,
      query,
    );
  }

  /**
   * 撤回一次發送（D18）：發送紀錄改成 `revoked`（保留全文給管理者查），刪除它的所有通知並推給收件人。
   * 與分批寫入以發送紀錄的列鎖互斥：撤回提交後不會再有一批寫進去，先提交的那一批由這裡之後刪掉。
   */
  async revoke(
    announcementId: string,
    dispatchId: string,
    actor: AuthUser,
  ): Promise<AnnouncementDispatchDto> {
    const announcement = await this.getExisting(announcementId);
    await withTransaction(this.db, async (tx) => {
      const dispatch = await this.repo.lockDispatch(dispatchId, tx);
      if (dispatch?.announcementId !== announcementId) {
        throw new AppException('ANNOUNCEMENT_DISPATCH_NOT_FOUND');
      }
      if (dispatch.status === 'revoked') {
        throw new AppException('ANNOUNCEMENT_DISPATCH_NOT_REVOCABLE', { status: dispatch.status });
      }
      await this.repo.updateDispatch(
        dispatchId,
        { status: 'revoked', revokedAt: new Date(), revokedBy: actor.id },
        tx,
      );
      await this.audit.record(
        {
          action: 'announcementDispatch.revoke',
          resourceType: RESOURCE_TYPE.ANNOUNCEMENT,
          resourceId: announcementId,
          resourceName: announcement.title,
          changes: { before: { status: dispatch.status }, after: { status: 'revoked' } },
          metadata: { dispatchId, recipientCount: dispatch.recipientCount },
        },
        tx,
      );
    });
    const removed = await this.notifications.removeBySource(dispatchId);
    this.publish(ChangeKind.UPDATE, announcementId);
    const row = await this.repo.findDispatchWithPeople(dispatchId);
    if (!row) throw new AppException('ANNOUNCEMENT_DISPATCH_NOT_FOUND');
    return toDispatchDto(row, new Map([[dispatchId, { total: removed, read: 0 }]]));
  }

  /**
   * 收件人讀全文：只有收到這次發送的人看得到（有 `source_id` 是它、收件人是自己的通知），
   * 同時把那則通知標為已讀。不透露別人的發送是否存在：都回 404。
   */
  async readMessage(dispatchId: string, actor: AuthUser): Promise<AnnouncementMessageDto> {
    const dispatch = await this.repo.findDispatchWithPeople(dispatchId);
    if (!dispatch || !(await this.notifications.markSourceRead(dispatchId, actor.id))) {
      throw new AppException('ANNOUNCEMENT_MESSAGE_NOT_FOUND');
    }
    return {
      dispatchId,
      title: dispatch.title,
      body: dispatch.body,
      sentAt: (dispatch.startedAt ?? dispatch.scheduledFor).toISOString(),
      sender: dispatch.creator,
    };
  }

  // ── 內部 ─────────────────────────────────────────────

  private async transition(
    id: string,
    dto: AnnouncementActionDto,
    actor: AuthUser,
    rule: {
      from: AnnouncementRow['status'];
      action: 'announcement.pause' | 'announcement.resume';
      values: (row: AnnouncementRow) => Promise<Pick<AnnouncementRow, 'status' | 'nextRunAt'>>;
    },
  ): Promise<AnnouncementDto> {
    const current = await this.getExisting(id);
    this.assertVersion(current, dto.version);
    if (current.status !== rule.from) {
      throw new AppException('ANNOUNCEMENT_INVALID_STATE', { status: current.status });
    }
    const values = await rule.values(current);
    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(
        id,
        { ...values, updatedBy: actor.id },
        dto.version,
        tx,
      );
      if (!updated)
        throw await missedUpdate(() => this.repo.findVersion(id, tx), ANNOUNCEMENT_LOCK_CODES);
      if (values.nextRunAt) await this.scheduler.enqueue(id, values.nextRunAt, tx);
      await this.audit.record(
        {
          action: rule.action,
          resourceType: RESOURCE_TYPE.ANNOUNCEMENT,
          resourceId: id,
          resourceName: updated.title,
          changes: { before: { status: current.status }, after: { status: updated.status } },
          metadata: { nextRunAt: values.nextRunAt?.toISOString() ?? null },
        },
        tx,
      );
    });
    this.publish(ChangeKind.UPDATE, id);
    return this.findOne(id);
  }

  /** 事件點要是目錄上（所屬 feature 已啟用）的觸發點；沒有就 `400 ANNOUNCEMENT_EVENT_UNKNOWN`。 */
  private assertKnownEvent(trigger: AnnouncementTriggerValue): void {
    if (trigger.kind !== 'event') return;
    if (!this.listTriggerEvents().some((item) => item.event === trigger.event)) {
      throw new AppException('ANNOUNCEMENT_EVENT_UNKNOWN', { event: trigger.event });
    }
  }

  /** 可以訂的觸發點（目錄的順序；所屬 feature 沒啟用的不列出）。 */
  listTriggerEvents(): Array<{ event: string; scope: AnnouncementTriggerScope }> {
    const features = requireTenant().features;
    return this.triggers
      .list()
      .filter((item) => !item.feature || features.includes(item.feature))
      .map(({ event, scope }) => ({ event, scope }));
  }

  private assertVersion(row: AnnouncementRow, version: number): void {
    if (version !== row.version) {
      throw new AppException('ANNOUNCEMENT_VERSION_CONFLICT', { current: row.version });
    }
  }

  /** 草稿以外的公告會對外發話：修改要 `announcement:publish`（路由只宣告了 update）。 */
  /** 改已送出的公告（排程中、暫停中）要 `announcement:publish`；路由只宣告了 `announcement:update`。 */
  private assertCanPublish(actor: AuthUser, id: string): Promise<void> {
    return this.permissions.assertHasAll(actor, [PERMISSION.ANNOUNCEMENT_PUBLISH], {
      route: 'PATCH /announcements/:id',
      metadata: { announcementId: id },
    });
  }

  private async getExisting(id: string): Promise<AnnouncementRow> {
    const row = await this.repo.findActive(id);
    if (!row) throw new AppException('ANNOUNCEMENT_NOT_FOUND');
    return row;
  }

  private publish(kind: ChangeKind, id: string): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.ANNOUNCEMENT, kind, id }],
    });
  }
}
