import { Injectable } from '@nestjs/common';

import type { Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { JobQueue } from '@/core/jobs';
import { DEFAULT_TIMEZONE_SETTING, SettingService } from '@/core/settings';
import type { AnnouncementTriggerValue } from '@/db/schema';

import { ANNOUNCEMENT_DISPATCH_JOB } from './announcement.job-types';
import { nextOccurrence, upcomingOccurrences } from './announcement.recurrence';

/**
 * 排程的時間怎麼算、怎麼排（docs/adr/0031-announcements.md D7、D8、D11）。送出、恢復、改時間（service）與
 * 發送完算下一次、每日維護（背景工作）都經過這裡，規則只有一份。週期依租戶的 `general.defaultTimezone` 計算。
 */
@Injectable()
export class AnnouncementScheduler {
  constructor(
    private readonly settings: SettingService,
    private readonly jobs: JobQueue,
  ) {}

  /** 租戶的時區（週期的日曆依它）。 */
  timeZone(): Promise<string> {
    return this.settings.get(DEFAULT_TIMEZONE_SETTING);
  }

  /**
   * `after` 之後的下一次；`sent` 是已經發過幾次（週期的次數上限）。立即發送沒有排程，回 `undefined`；
   * 指定時間只有一次：還沒到才算。
   */
  async nextRun(
    trigger: AnnouncementTriggerValue,
    after: Date,
    sent: number,
  ): Promise<Date | undefined> {
    switch (trigger.kind) {
      case 'immediate':
      case 'event':
        // 立即發送與事件點都沒有時間表
        return undefined;
      case 'once': {
        const at = new Date(trigger.at);
        return sent === 0 && at.getTime() > after.getTime() ? at : undefined;
      }
      case 'recurring':
        if (trigger.maxOccurrences && sent >= trigger.maxOccurrences) return undefined;
        return nextOccurrence(trigger, after, await this.timeZone());
    }
  }

  /**
   * 送出或恢復後的狀態：事件點是排程中但沒有下一次（等事件發生）；指定時間與週期要有第一次（`firstRun`）。
   */
  async scheduledState(
    trigger: Exclude<AnnouncementTriggerValue, { kind: 'immediate' }>,
    sent: number,
  ): Promise<{ status: 'scheduled'; nextRunAt: Date | null }> {
    if (trigger.kind === 'event') return { status: 'scheduled', nextRunAt: null };
    return { status: 'scheduled', nextRunAt: await this.firstRun(trigger, sent) };
  }

  /**
   * 送出或恢復時的第一次：一定要有，否則 `400 ANNOUNCEMENT_TRIGGER_IN_PAST`（指定的時間已過；週期已過結束日期或次數用完）。
   */
  async firstRun(trigger: AnnouncementTriggerValue, sent: number): Promise<Date> {
    const next = await this.nextRun(trigger, new Date(), sent);
    if (next) return next;
    throw new AppException(
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      trigger.kind === 'once' ? { at: trigger.at } : { reason: 'noOccurrence' },
    );
  }

  /** 週期的預覽：接下來最多 `count` 次。 */
  async preview(
    trigger: Extract<AnnouncementTriggerValue, { kind: 'recurring' }>,
    count: number,
  ): Promise<{ timeZone: string; occurrences: Date[] }> {
    const timeZone = await this.timeZone();
    return {
      timeZone,
      occurrences: upcomingOccurrences(
        trigger,
        new Date(),
        timeZone,
        count,
        trigger.maxOccurrences ?? Number.POSITIVE_INFINITY,
      ),
    };
  }

  /** 延遲到那個時間的工作，帶上時間讓它判斷自己是不是過時的（D8）。在改變排程的交易內呼叫。 */
  async enqueue(announcementId: string, runAt: Date, tx: Transaction): Promise<void> {
    await this.jobs.enqueue(
      ANNOUNCEMENT_DISPATCH_JOB,
      { announcementId, runAt: runAt.toISOString() },
      { tx, startAfter: runAt },
    );
  }
}
