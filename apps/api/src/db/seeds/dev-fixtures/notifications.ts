import {
  APPROVAL_PENDING_NOTIFICATION,
  APPROVAL_RESULT_NOTIFICATION,
} from '@/modules/approval/approval.notifications';
import type {
  ApprovalPendingParams,
  ApprovalResultParams,
} from '@/modules/approval/approval.notifications';
import {
  ACCOUNT_PROFILE_LINK,
  USER_ROLES_CHANGED_NOTIFICATION,
} from '@/modules/user/user.notifications';
import type { UserRolesChangedParams } from '@/modules/user/user.notifications';
import {
  WEBHOOK_DISABLED_NOTIFICATION,
  webhookDetailLink,
} from '@/modules/webhook/webhook.notifications';
import type { WebhookDisabledParams } from '@/modules/webhook/webhook.notifications';

import type { ScriptDatabase } from '../../client';
import { notifications } from '../../schema';
import type { NotificationInsert } from '../../schema';
import type { DevFixtureContext } from './context';
import { ago, fixtureId } from './context';
import { FAILING_WEBHOOK } from './webhooks';

/**
 * 公告以外的站內通知（docs/architecture/backend/15-notification.md）：目錄裡每一種類型都有幾筆，散在近兩週，已讀與未讀混合。
 * 公告的 `announcement.published` 由 announcements.ts 隨發送紀錄寫入。
 *
 * 審批的通知 **沒有連結**：seed 不建立審批申請（申請要經過各類型 handler 的流程），連到不存在的申請只會 404。
 */

interface NotificationSeed {
  key: string;
  recipient: string | null;
  type: string;
  params:
    | UserRolesChangedParams
    | ApprovalPendingParams
    | ApprovalResultParams
    | WebhookDisabledParams;
  link: NotificationInsert['link'];
  /** null＝系統。 */
  actorId: string | null;
  createdDaysAgo: number;
  /** 讀取的時間（建立後幾小時）；null＝未讀。 */
  readAfterHours: number | null;
}

function buildSeeds(ctx: DevFixtureContext): NotificationSeed[] {
  const user = (serial: number): string | null => ctx.userIds[serial - 1] ?? null;
  const actor = ctx.actorId;

  const rolesChanged: NotificationSeed[] = [
    { serial: 1, added: ['發佈管理'], removed: [], days: 0.2, read: null },
    { serial: 2, added: ['測試'], removed: ['唯讀'], days: 1.5, read: 3 },
    { serial: 5, added: ['內容編輯', '客服'], removed: [], days: 2.4, read: null },
    { serial: 8, added: [], removed: ['客服'], days: 4.1, read: 20 },
    { serial: 14, added: ['客服'], removed: [], days: 6, read: 1 },
    { serial: 22, added: ['內容編輯'], removed: [], days: 9, read: 5 },
    { serial: 27, added: ['唯讀'], removed: ['測試'], days: 11, read: null },
    { serial: 33, added: ['發佈管理'], removed: [], days: 13, read: 48 },
  ].map((item) => ({
    key: `roles-changed:${item.serial}`,
    recipient: user(item.serial),
    type: USER_ROLES_CHANGED_NOTIFICATION.type,
    params: { added: item.added, removed: item.removed },
    link: ACCOUNT_PROFILE_LINK,
    actorId: actor,
    createdDaysAgo: item.days,
    readAfterHours: item.read,
  }));

  // 待審核：收件人是審核者（super-admin 與幾位 dev 使用者）
  const pending: NotificationSeed[] = [
    {
      to: actor,
      requester: 'new.member@example.com',
      subject: '陳柏翰',
      type: 'user.register',
      days: 0.1,
      read: null,
    },
    {
      to: actor,
      requester: 'dev15@dev.local',
      subject: '專案文件',
      type: 'fileFolder.access',
      days: 0.8,
      read: null,
    },
    {
      to: actor,
      requester: 'partner@example.org',
      subject: '吳佩珊',
      type: 'user.register',
      days: 3,
      read: 2,
    },
    {
      to: user(13),
      requester: 'dev03@dev.local',
      subject: '對外簡報',
      type: 'fileFolder.access',
      days: 1.2,
      read: null,
    },
    {
      to: user(13),
      requester: 'contractor@example.com',
      subject: '劉子軒',
      type: 'user.register',
      days: 5,
      read: 6,
    },
  ].map((item, index) => ({
    key: `approval-pending:${index}`,
    recipient: item.to,
    type: APPROVAL_PENDING_NOTIFICATION.type,
    params: {
      approvalType: item.type as ApprovalPendingParams['approvalType'],
      requesterName: item.requester,
      subject: item.subject,
    },
    link: null,
    actorId: null,
    createdDaysAgo: item.days,
    readAfterHours: item.read,
  }));

  // 審批結果：收件人是申請人
  const results: NotificationSeed[] = [
    { serial: 15, subject: '專案文件', status: 'approved', days: 0.5, read: null },
    { serial: 3, subject: '對外簡報', status: 'rejected', days: 2, read: 1 },
    { serial: 18, subject: '教育訓練教材', status: 'approved', days: 7, read: 4 },
    { serial: 24, subject: '專案文件', status: 'rejected', days: 10, read: null },
  ].map((item) => ({
    key: `approval-result:${item.serial}`,
    recipient: user(item.serial),
    type: APPROVAL_RESULT_NOTIFICATION.type,
    params: {
      approvalType: 'fileFolder.access',
      subject: item.subject,
      status: item.status as ApprovalResultParams['status'],
    },
    link: null,
    actorId: actor,
    createdDaysAgo: item.days,
    readAfterHours: item.read,
  }));

  // 連續失敗自動停用（webhooks.ts 的「舊版通知閘道」）：通知管理者，系統發出
  const webhookDisabled: NotificationSeed[] = [actor, user(13)].map((recipient, index) => ({
    key: `webhook-disabled:${index}`,
    recipient,
    type: WEBHOOK_DISABLED_NOTIFICATION.type,
    params: {
      webhookName: FAILING_WEBHOOK.name,
      consecutiveFailures: FAILING_WEBHOOK.consecutiveFailures,
      url: FAILING_WEBHOOK.url,
    },
    link: webhookDetailLink(FAILING_WEBHOOK.id),
    actorId: null,
    createdDaysAgo: FAILING_WEBHOOK.disabledDaysAgo,
    readAfterHours: index === 0 ? null : 10,
  }));

  return [...rolesChanged, ...pending, ...results, ...webhookDisabled, ...superAdminInbox(ctx)];
}

/**
 * 登入 dev 的 super-admin 自己的通知中心：上面幾組大多寄給 dev 使用者，這組補齊各種情境——
 * 每種類型、有無觸發者（系統）、有無連結、參數的邊界（只增／只減／都有、長名稱、升版前沒有 url），
 * 時間從幾分鐘前到超過兩週（相對時間與日期兩種顯示）。
 */
function superAdminInbox(ctx: DevFixtureContext): NotificationSeed[] {
  const actor = ctx.actorId;
  const by = (serial: number): string | null => ctx.userIds[serial - 1] ?? null;
  const seed = (
    key: string,
    rest: Omit<NotificationSeed, 'key' | 'recipient'>,
  ): NotificationSeed => ({ key: `inbox:${key}`, recipient: actor, ...rest });

  return [
    seed('roles-added', {
      type: USER_ROLES_CHANGED_NOTIFICATION.type,
      params: { added: ['稽核'], removed: [] },
      link: ACCOUNT_PROFILE_LINK,
      actorId: by(13),
      createdDaysAgo: 0.002,
      readAfterHours: null,
    }),
    seed('roles-removed', {
      type: USER_ROLES_CHANGED_NOTIFICATION.type,
      params: { added: [], removed: ['客服'] },
      link: ACCOUNT_PROFILE_LINK,
      actorId: by(7),
      createdDaysAgo: 1.1,
      readAfterHours: 2,
    }),
    seed('roles-swapped-by-system', {
      type: USER_ROLES_CHANGED_NOTIFICATION.type,
      params: { added: ['發佈管理', '內容編輯', '客服'], removed: ['唯讀', '測試'] },
      link: ACCOUNT_PROFILE_LINK,
      actorId: null,
      createdDaysAgo: 16,
      readAfterHours: 30,
    }),
    seed('pending-register-now', {
      type: APPROVAL_PENDING_NOTIFICATION.type,
      params: {
        approvalType: 'user.register',
        requesterName: 'lin.yating@example.com',
        subject: '林雅婷',
      },
      link: null,
      actorId: null,
      createdDaysAgo: 0.02,
      readAfterHours: null,
    }),
    seed('pending-folder-long-name', {
      type: APPROVAL_PENDING_NOTIFICATION.type,
      params: {
        approvalType: 'fileFolder.access',
        requesterName: 'dev21@dev.local',
        subject: '2026 年度第四季跨部門專案規劃與預算審核資料（含附件與會議紀錄）',
      },
      link: null,
      actorId: null,
      createdDaysAgo: 0.3,
      readAfterHours: null,
    }),
    seed('pending-folder-old', {
      type: APPROVAL_PENDING_NOTIFICATION.type,
      params: {
        approvalType: 'fileFolder.access',
        requesterName: 'dev09@dev.local',
        subject: '人事規章',
      },
      link: null,
      actorId: null,
      createdDaysAgo: 8,
      readAfterHours: 12,
    }),
    seed('result-approved', {
      type: APPROVAL_RESULT_NOTIFICATION.type,
      params: { approvalType: 'fileFolder.access', subject: '財務報表', status: 'approved' },
      link: null,
      actorId: by(13),
      createdDaysAgo: 0.6,
      readAfterHours: null,
    }),
    seed('result-rejected', {
      type: APPROVAL_RESULT_NOTIFICATION.type,
      params: { approvalType: 'fileFolder.access', subject: '法務合約', status: 'rejected' },
      link: null,
      actorId: by(13),
      createdDaysAgo: 2.5,
      readAfterHours: 1,
    }),
    seed('result-approved-old', {
      type: APPROVAL_RESULT_NOTIFICATION.type,
      params: { approvalType: 'fileFolder.access', subject: '設計素材', status: 'approved' },
      link: null,
      actorId: by(7),
      createdDaysAgo: 20,
      readAfterHours: 4,
    }),
    seed('webhook-disabled-recent', {
      type: WEBHOOK_DISABLED_NOTIFICATION.type,
      params: {
        webhookName: FAILING_WEBHOOK.name,
        consecutiveFailures: 50,
        url: FAILING_WEBHOOK.url,
      },
      link: webhookDetailLink(FAILING_WEBHOOK.id),
      actorId: null,
      createdDaysAgo: 0.05,
      readAfterHours: null,
    }),
    // 升版前寫入的通知沒有 url（docs/architecture/backend/17-webhook.md §10.2 D15）
    seed('webhook-disabled-legacy', {
      type: WEBHOOK_DISABLED_NOTIFICATION.type,
      params: { webhookName: FAILING_WEBHOOK.name, consecutiveFailures: 10 },
      link: webhookDetailLink(FAILING_WEBHOOK.id),
      actorId: null,
      createdDaysAgo: 25,
      readAfterHours: 72,
    }),
  ];
}

export async function seedNotificationFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
): Promise<number> {
  const rows = buildSeeds(ctx).flatMap((seed) => {
    // 收件人不存在（租戶還沒有 super-admin）就略過；觸發者等於收件人時不通知（D7）
    if (!seed.recipient || seed.recipient === seed.actorId) return [];
    const createdAt = ago(ctx.now, 0, seed.createdDaysAgo * 24);
    const readAt =
      seed.readAfterHours === null
        ? null
        : new Date(
            Math.min(createdAt.getTime() + seed.readAfterHours * 3_600_000, ctx.now.getTime()),
          );
    return [
      {
        id: fixtureId(`notification:${seed.key}`),
        recipientId: seed.recipient,
        type: seed.type,
        params: { ...seed.params },
        link: seed.link,
        actorId: seed.actorId,
        readAt,
        createdAt,
      },
    ];
  });
  if (rows.length === 0) return 0;
  // 回傳這次真的寫入的筆數（已存在的略過）
  const inserted = await db
    .insert(notifications)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return inserted.length;
}
