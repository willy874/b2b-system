import { and, inArray } from 'drizzle-orm';

import {
  ANNOUNCEMENT_PUBLISHED_NOTIFICATION,
  announcementMessageLink,
} from '@/modules/announcement/announcement.notifications';
import { upcomingOccurrences } from '@/modules/announcement/announcement.recurrence';
import { USER_ACTIVATED_TRIGGER } from '@/modules/user/user.announcement-triggers';

import type { ScriptDatabase } from '../../client';
import {
  announcementDispatches,
  announcements,
  isRoleHolderTuple,
  notifications,
  relationTuples,
} from '../../schema';
import type {
  AnnouncementAudienceValue,
  AnnouncementRecurringTrigger,
  AnnouncementStatus,
  AnnouncementTriggerValue,
} from '../../schema';
import type { DevFixtureContext } from './context';
import { ago, createRandom, expandGroupMembers, fixtureId, later } from './context';

/**
 * 公告（docs/architecture/backend/19-announcement.md）：草稿、排程中（指定時間、週期、事件點）、暫停、已完成、撤回與已刪除各一些，
 * 已發出的附上發送紀錄與收件人的 `announcement.published` 通知（`source_id` 指向發送紀錄，通知總覽與收件人的鈴鐺都看得到）。
 *
 * 只在公告第一次寫入時連同發送紀錄與通知一起寫；已存在的公告（含被人改過、刪掉又還原的）整則略過。
 * 排程中的公告是真的排程：api 的每日維護（`announcement.maintenance`）會補上延遲工作，時間到了會真的發送。
 */

const HOUR_MS = 60 * 60 * 1000;

interface DispatchPlan {
  scheduledFor: Date;
  status: 'sent' | 'revoked';
  /** 收件人；null＝依公告的受眾解析。 */
  recipients?: string[];
  triggerSubjectId?: string;
  /** 已讀的比例（0～1）。 */
  readRatio: number;
}

interface AnnouncementPlan {
  key: string;
  title: string;
  body: string;
  audience: AnnouncementAudienceValue;
  trigger: AnnouncementTriggerValue;
  status: AnnouncementStatus;
  nextRunAt: Date | null;
  version: number;
  createdAt: Date;
  deletedAt?: Date;
  dispatches: DispatchPlan[];
}

function audience(partial: Partial<AnnouncementAudienceValue>): AnnouncementAudienceValue {
  return { all: false, userIds: [], groupIds: [], roleIds: [], ...partial };
}

/** 租戶時區的日曆日（`YYYY-MM-DD`），週期的 `startsOn` 用它。 */
function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function buildPlans(ctx: DevFixtureContext): AnnouncementPlan[] {
  const { now } = ctx;
  const groupIds = (...names: string[]): string[] =>
    names.map((name) => ctx.groupIdByName.get(name)).filter((id): id is string => Boolean(id));
  const roleIds = (...slugs: string[]): string[] =>
    slugs.map((slug) => ctx.roleIdBySlug.get(slug)).filter((id): id is string => Boolean(id));
  const user = (serial: number): string | undefined => ctx.userIds[serial - 1];

  // 每週一 09:00 的週期：從三週前開始，過去的幾次已發出，下一次排在之後的週一
  const weekly: AnnouncementRecurringTrigger = {
    kind: 'recurring',
    frequency: 'weekly',
    interval: 1,
    weekdays: [1],
    time: '09:00',
    startsOn: localDay(ago(now, 20), ctx.timeZone),
    endsOn: null,
    maxOccurrences: null,
  };
  const occurrences = upcomingOccurrences(weekly, ago(now, 21), ctx.timeZone, 6);
  const pastWeekly = occurrences.filter((at) => at <= now);
  const nextWeekly = occurrences.find((at) => at > now) ?? null;

  // 指定時間：五天後（租戶時區）的 10:00
  const fiveDaysLater = later(now, 5);
  const onceAt =
    upcomingOccurrences(
      {
        kind: 'recurring',
        frequency: 'daily',
        interval: 1,
        time: '10:00',
        startsOn: localDay(fiveDaysLater, ctx.timeZone),
      },
      ago(fiveDaysLater, 1),
      ctx.timeZone,
      1,
    )[0] ?? fiveDaysLater;

  const welcomeSubjects = [9, 10, 11]
    .map((serial, index) => ({ id: user(serial), daysAgo: 12 - index * 4 }))
    .filter((item): item is { id: string; daysAgo: number } => Boolean(item.id));

  return [
    {
      key: 'system-upgrade',
      title: '系統升級完成通知',
      body: '後台已於昨晚完成版本升級，新增批次匯出與進階篩選。若發現任何異常，請透過客服信箱回報，我們會儘速處理。',
      audience: audience({ all: true }),
      trigger: { kind: 'immediate' },
      status: 'completed',
      nextRunAt: null,
      version: 2,
      createdAt: ago(now, 3, 2),
      dispatches: [{ scheduledFor: ago(now, 3), status: 'sent', readRatio: 0.7 }],
    },
    {
      key: 'manual-online',
      title: '新版操作手冊已上線',
      body: '操作手冊已更新至最新版本，內容涵蓋帳號管理、檔案分享與審批流程。請於本週內完成閱讀，有疑問可在週會提出。',
      audience: audience({ groupIds: groupIds('客服中心', '內容團隊') }),
      trigger: { kind: 'immediate' },
      status: 'completed',
      nextRunAt: null,
      version: 2,
      createdAt: ago(now, 8, 1),
      dispatches: [{ scheduledFor: ago(now, 8), status: 'sent', readRatio: 0.85 }],
    },
    {
      key: 'weekly-timesheet',
      title: '每週一提醒：填寫上週工時',
      body: '請在今天下班前完成上週的工時填報，以利月底結算。',
      audience: audience({ groupIds: groupIds('工程部') }),
      trigger: weekly,
      status: 'scheduled',
      nextRunAt: nextWeekly,
      version: 2,
      createdAt: ago(now, 21),
      dispatches: pastWeekly.map((at, index) => ({
        scheduledFor: at,
        status: 'sent' as const,
        // 越早的一次越多人讀過
        readRatio: index === pastWeekly.length - 1 ? 0.4 : 0.9,
      })),
    },
    {
      key: 'security-training',
      title: '年度資訊安全教育訓練',
      body: '年度資安教育訓練開放報名，課程約 60 分鐘，內容包含密碼管理、社交工程與資料分級。請於月底前完成線上課程。',
      audience: audience({ all: true }),
      trigger: { kind: 'once', at: onceAt.toISOString() },
      status: 'scheduled',
      nextRunAt: onceAt,
      version: 2,
      createdAt: ago(now, 1),
      dispatches: [],
    },
    {
      key: 'welcome',
      title: '歡迎加入！新進同仁入門指南',
      body: '歡迎加入團隊！請先完成個人資料設定與多因素驗證，並到共用資料夾閱讀「新進同仁手冊」。有任何問題可以聯繫你的主管。',
      audience: audience({ all: true }),
      trigger: { kind: 'event', event: USER_ACTIVATED_TRIGGER.event, delayMinutes: 60 },
      status: 'scheduled',
      // 事件點沒有時間表
      nextRunAt: null,
      version: 2,
      createdAt: ago(now, 30),
      dispatches: welcomeSubjects.map((subject) => ({
        scheduledFor: ago(now, subject.daysAgo),
        status: 'sent' as const,
        recipients: [subject.id],
        triggerSubjectId: subject.id,
        readRatio: 1,
      })),
    },
    {
      key: 'quarterly-inventory',
      title: '季末資產盤點提醒',
      body: '每月最後一天 17:00 前，請各部門回報設備與授權的盤點結果。',
      audience: audience({ groupIds: groupIds('稽核小組') }),
      trigger: {
        kind: 'recurring',
        frequency: 'monthly',
        interval: 1,
        monthDay: 'last',
        time: '17:00',
        startsOn: localDay(now, ctx.timeZone),
        endsOn: null,
        maxOccurrences: 12,
      },
      status: 'draft',
      nextRunAt: null,
      version: 1,
      createdAt: ago(now, 2),
      dispatches: [],
    },
    {
      key: 'year-end-party',
      title: '年末聚餐報名開始',
      body: '年末聚餐將於下個月舉辦，請於報名表填寫出席意願與飲食需求。',
      audience: audience({
        roleIds: roleIds('support', 'content-editor'),
        userIds: [user(13)].filter((id): id is string => Boolean(id)),
      }),
      trigger: { kind: 'once', at: later(now, 12).toISOString() },
      // 送出後又暫停：不在排程中，`next_run_at` 為 null
      status: 'paused',
      nextRunAt: null,
      version: 3,
      createdAt: ago(now, 4),
      dispatches: [],
    },
    {
      key: 'wrong-maintenance',
      title: '系統維護時間調整',
      body: '本週六的系統維護改到 20:00 開始。',
      audience: audience({ all: true }),
      trigger: { kind: 'immediate' },
      status: 'completed',
      nextRunAt: null,
      version: 2,
      createdAt: ago(now, 6, 3),
      // 時間寫錯而撤回：發送紀錄保留全文，通知已刪除
      dispatches: [{ scheduledFor: ago(now, 6, 2), status: 'revoked', readRatio: 0 }],
    },
    {
      key: 'old-duty-roster',
      title: '連假值班表（舊版）',
      body: '連假期間的值班表如附件，已由新版取代。',
      audience: audience({ groupIds: groupIds('客服中心') }),
      trigger: { kind: 'immediate' },
      status: 'draft',
      nextRunAt: null,
      version: 1,
      createdAt: ago(now, 15),
      // 回收桶
      deletedAt: ago(now, 5),
      dispatches: [],
    },
  ];
}

export interface AnnouncementFixtureResult {
  announcements: number;
  dispatches: number;
  notifications: number;
}

export async function seedAnnouncementFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
): Promise<AnnouncementFixtureResult> {
  const random = createRandom(20_261_008);
  const plans = buildPlans(ctx);
  const result: AnnouncementFixtureResult = {
    announcements: plans.length,
    dispatches: 0,
    notifications: 0,
  };

  for (const plan of plans) {
    const announcementId = fixtureId(`announcement:${plan.key}`);
    const updatedAt = plan.deletedAt ?? plan.dispatches.at(-1)?.scheduledFor ?? plan.createdAt;
    // oxlint-disable-next-line no-await-in-loop -- seed 腳本，筆數少，依序執行
    const [created] = await db
      .insert(announcements)
      .values({
        id: announcementId,
        title: plan.title,
        body: plan.body,
        audience: plan.audience,
        trigger: plan.trigger,
        status: plan.status,
        nextRunAt: plan.nextRunAt,
        version: plan.version,
        createdAt: plan.createdAt,
        createdBy: ctx.actorId,
        updatedAt: updatedAt < plan.createdAt ? plan.createdAt : updatedAt,
        updatedBy: ctx.actorId,
        deletedAt: plan.deletedAt ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: announcements.id });
    if (!created) continue;

    // oxlint-disable-next-line no-await-in-loop -- 同上
    const audienceRecipients = await resolveRecipients(db, ctx, plan.audience);
    for (const [index, dispatch] of plan.dispatches.entries()) {
      const dispatchId = fixtureId(`announcement-dispatch:${plan.key}:${index}`);
      const recipients = (dispatch.recipients ?? audienceRecipients).filter(
        // 送出者自己不收（notify() 的規則）
        (id) => id !== ctx.actorId,
      );
      const finishedAt = new Date(dispatch.scheduledFor.getTime() + 4000);
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await db
        .insert(announcementDispatches)
        .values({
          id: dispatchId,
          announcementId,
          scheduledFor: dispatch.scheduledFor,
          title: plan.title,
          body: plan.body,
          audience: plan.audience,
          status: dispatch.status,
          triggerSubjectId: dispatch.triggerSubjectId ?? null,
          recipientCount: recipients.length,
          details: { skipped: { userIds: [], groupIds: [], roleIds: [] } },
          createdBy: ctx.actorId,
          createdAt: dispatch.scheduledFor,
          startedAt: new Date(dispatch.scheduledFor.getTime() + 1000),
          finishedAt,
          revokedAt:
            dispatch.status === 'revoked' ? new Date(finishedAt.getTime() + 20 * 60_000) : null,
          revokedBy: dispatch.status === 'revoked' ? ctx.actorId : null,
        })
        .onConflictDoNothing();
      result.dispatches += 1;

      // 撤回的發送：通知已刪除
      if (dispatch.status === 'revoked' || recipients.length === 0) continue;
      const rows = recipients.map((recipientId) => {
        const isRead = random() < dispatch.readRatio;
        const readAt = new Date(finishedAt.getTime() + Math.floor(random() * 30 * HOUR_MS));
        return {
          id: fixtureId(`notification:${dispatchId}:${recipientId}`),
          recipientId,
          type: ANNOUNCEMENT_PUBLISHED_NOTIFICATION.type,
          params: { title: plan.title },
          link: announcementMessageLink(dispatchId),
          actorId: ctx.actorId,
          sourceId: dispatchId,
          readAt: isRead && readAt < ctx.now ? readAt : null,
          createdAt: finishedAt,
        };
      });
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await db.insert(notifications).values(rows).onConflictDoNothing();
      result.notifications += rows.length;
    }
  }
  return result;
}

/**
 * 受眾解析成人（docs/architecture/backend/19-announcement.md §4 的簡化版）：只取可登入的 dev 使用者，
 * 群組沿巢狀展開；角色只算直接持有的人。
 */
async function resolveRecipients(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  value: AnnouncementAudienceValue,
): Promise<string[]> {
  if (value.all) return ctx.userIds.filter((id) => ctx.activeUserIds.has(id));
  const ids = new Set<string>(value.userIds);
  for (const id of await expandGroupMembers(db, value.groupIds)) ids.add(id);
  for (const id of await roleHolders(db, value.roleIds)) ids.add(id);
  return ctx.userIds.filter((id) => ids.has(id) && ctx.activeUserIds.has(id));
}

async function roleHolders(db: ScriptDatabase, roleIds: readonly string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const rows = await db
    .select({ userId: relationTuples.subjectId })
    .from(relationTuples)
    .where(and(isRoleHolderTuple(), inArray(relationTuples.objectId, [...roleIds])));
  return rows.map((row) => row.userId);
}
