import { Injectable } from '@nestjs/common';

import type { Transaction } from '@/core/database';
import { JobQueue } from '@/core/jobs';
import { requireTenant } from '@/core/tenant';

import { AnnouncementTriggerCatalog } from './announcement-trigger.catalog';
import { ANNOUNCEMENT_EVENT_DISPATCH_JOB } from './announcement.job-types';
import { AnnouncementRepository } from './announcement.repository';
import type {
  AnnouncementTriggerDefinition,
  AnnouncementTriggerFire,
} from './announcement.triggers';

const MINUTE_MS = 60 * 1000;

/**
 * 事件點的入口（docs/adr/0031-announcements.md D12）：擁有者模組在自己的業務交易內（稽核之後）呼叫 `fire()`。
 * 不訂閱 `DomainEventBus`（不保證送達）：入列走交易內的 outbox，業務寫入成功工作就一定在。
 *
 * `fire()` 只做一件事：找出訂了這個觸發點、排程中的公告，每則 × 每位使用者入列一筆延遲工作（`startAfter` = 現在＋延遲）。
 * 是不是在受眾裡、是不是已經發過，在工作執行時才判斷（那時的受眾才是準的）。沒有公告時成本是一次有索引的查詢。
 */
@Injectable()
export class AnnouncementTriggerService {
  constructor(
    private readonly catalog: AnnouncementTriggerCatalog,
    private readonly repo: AnnouncementRepository,
    private readonly jobs: JobQueue,
  ) {}

  async fire(
    trigger: AnnouncementTriggerDefinition,
    data: AnnouncementTriggerFire,
    tx: Transaction,
  ): Promise<void> {
    // 沒登記是程式錯誤：在擁有者的測試裡就會被發現
    this.catalog.get(trigger.event);
    const features = requireTenant().features;
    if (!features.includes('announcement')) return;
    if (trigger.feature && !features.includes(trigger.feature)) return;
    if (data.userIds.length === 0) return;

    const subscribed = await this.repo.findScheduledByEvent(trigger.event, tx);
    const firedAt = new Date();
    for (const announcement of subscribed) {
      const runAt = new Date(firedAt.getTime() + announcement.delayMinutes * MINUTE_MS);
      for (const userId of new Set(data.userIds)) {
        // oxlint-disable-next-line no-await-in-loop -- 同一個交易連線上本來就依序執行；一次事件的人與公告都很少
        await this.jobs.enqueue(
          ANNOUNCEMENT_EVENT_DISPATCH_JOB,
          {
            announcementId: announcement.id,
            event: trigger.event,
            userId,
            runAt: runAt.toISOString(),
            ...(data.groupId && { groupId: data.groupId }),
            ...(data.roleIds && { roleIds: [...data.roleIds] }),
          },
          { tx, startAfter: runAt },
        );
      }
    }
  }
}
