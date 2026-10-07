import { SecretBox, WEBHOOK_SECRET_PURPOSE } from '@/core/crypto';
import { APPROVAL_DECIDED_WEBHOOK } from '@/modules/approval/approval.webhooks';
import { FILE_UPLOADED_WEBHOOK } from '@/modules/file/file.webhooks';
import {
  USER_CREATED_WEBHOOK,
  USER_DELETED_WEBHOOK,
  USER_RESTORED_WEBHOOK,
  USER_STATUS_CHANGED_WEBHOOK,
} from '@/modules/user/user.webhooks';
import {
  WEBHOOK_AUTO_DISABLE_AFTER_FAILURES,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
} from '@/modules/webhook/webhook.constants';
import type { AnyWebhookEventType, WebhookData } from '@/modules/webhook/webhook.definition';
import { generateWebhookSecret } from '@/modules/webhook/webhook.signature';

import type { ScriptDatabase } from '../../client';
import {
  webhookDeliveries,
  webhookEvents,
  webhookSubscriptions,
  webhookTargets,
} from '../../schema';
import type { DevFixtureContext } from './context';
import { ago, createRandom, fixtureId } from './context';

/**
 * Webhook（docs/architecture/backend/17-webhook.md）：幾個訂閱（啟用、手動停用、連續失敗自動停用、多個網址），
 * 加上近 9 天的對外事件與投遞紀錄。網址都是 example.com／example.org（RFC 2606 保留網域）。
 *
 * 投遞紀錄是寫好的歷史，不會真的送出；之後有新的事件時，啟用中的訂閱才會由 api 真的投遞（目標不存在，會失敗、重試）。
 * 訂閱與網址的 `last_delivery_at`、`consecutive_failures` 由產生的紀錄算出，與畫面上的紀錄一致。
 */

type Outcome =
  | { kind: 'ok'; status: 200 | 204 }
  | { kind: 'http'; status: 500 | 502 | 503 }
  | { kind: 'error'; error: 'TIMEOUT' | 'ECONNREFUSED' };

interface SubscriptionSeed {
  key: string;
  name: string;
  events: AnyWebhookEventType[];
  urls: string[];
  /** 停用：`manual` 是有人按了停用、`failing` 是連續失敗自動停用；停用之後的事件不投遞。 */
  disabled?: { reason: 'manual' | 'failing'; daysAgo: number };
  /** 第 `urlIndex` 個網址、第 `eventIndex` 個（此訂閱收到的）事件的投遞結果。 */
  outcome: (urlIndex: number, eventIndex: number, eventDaysAgo: number) => Outcome[];
}

const OK: Outcome[] = [{ kind: 'ok', status: 200 }];

const SUBSCRIPTIONS: SubscriptionSeed[] = [
  {
    key: 'crm-users',
    name: 'CRM 使用者同步',
    events: [USER_CREATED_WEBHOOK, USER_STATUS_CHANGED_WEBHOOK, USER_DELETED_WEBHOOK],
    urls: ['https://hooks.example.com/crm/users'],
    // 偶爾失敗一次，下一次重試成功
    outcome: (_url, eventIndex) => (eventIndex === 2 ? [{ kind: 'http', status: 500 }, ...OK] : OK),
  },
  {
    key: 'warehouse',
    name: '資料倉儲匯入',
    events: [
      USER_CREATED_WEBHOOK,
      USER_STATUS_CHANGED_WEBHOOK,
      USER_DELETED_WEBHOOK,
      USER_RESTORED_WEBHOOK,
      APPROVAL_DECIDED_WEBHOOK,
    ],
    urls: ['https://ingest.example.org/webhooks/b2b', 'https://backup.example.com/hooks/b2b'],
    // 第二個網址最近兩天一直回 503：連續失敗次數累積中，但還沒到自動停用的門檻
    outcome: (urlIndex, _event, daysAgo) =>
      urlIndex === 1 && daysAgo < 2
        ? [{ kind: 'http', status: 503 }]
        : [{ kind: 'ok', status: 204 }],
  },
  {
    key: 'file-scan',
    name: '檔案掃描服務',
    events: [FILE_UPLOADED_WEBHOOK],
    urls: ['https://scan.example.com/v1/events'],
    outcome: () => OK,
  },
  {
    key: 'legacy-gateway',
    name: '舊版通知閘道',
    events: [USER_CREATED_WEBHOOK, APPROVAL_DECIDED_WEBHOOK],
    urls: ['https://legacy-gateway.example.org/notify'],
    disabled: { reason: 'failing', daysAgo: 3 },
    outcome: (_url, eventIndex) => [
      eventIndex % 2 === 0
        ? { kind: 'error', error: 'TIMEOUT' }
        : { kind: 'error', error: 'ECONNREFUSED' },
      { kind: 'http', status: 502 },
    ],
  },
  {
    key: 'approval-relay',
    name: '審批結果轉發',
    events: [APPROVAL_DECIDED_WEBHOOK],
    urls: ['https://approvals.example.com/hook'],
    disabled: { reason: 'manual', daysAgo: 1 },
    outcome: () => OK,
  },
];

/** 「舊版通知閘道」：自動停用的那一個（`webhook.disabled` 通知指向它）。 */
export const FAILING_WEBHOOK = {
  id: fixtureId('webhook:legacy-gateway'),
  name: '舊版通知閘道',
  url: 'https://legacy-gateway.example.org/notify',
  consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER_FAILURES,
  disabledDaysAgo: 3,
};

interface EventSeed {
  id: string;
  type: AnyWebhookEventType;
  data: WebhookData;
  occurredAt: Date;
  daysAgo: number;
}

/** 近 9 天的對外事件：資料只有 id 與列舉值（D3），id 取自 dev 使用者與固定的假 id。 */
function buildEvents(ctx: DevFixtureContext, random: () => number): EventSeed[] {
  const user = (serial: number): string => ctx.userIds[serial - 1] ?? fixtureId(`user:${serial}`);
  const plan: { type: AnyWebhookEventType; data: WebhookData }[] = [
    ...[30, 31, 32, 33, 34, 35].map((serial) => ({
      type: USER_CREATED_WEBHOOK,
      data: { userId: user(serial) },
    })),
    ...[36, 37, 38].map((serial) => ({
      type: USER_STATUS_CHANGED_WEBHOOK,
      data: { userId: user(serial), status: 'inactive', previousStatus: 'active' },
    })),
    ...[44, 45].map((serial) => ({
      type: USER_STATUS_CHANGED_WEBHOOK,
      data: { userId: user(serial), status: 'active', previousStatus: 'pending' },
    })),
    ...['former01', 'former02', 'former03'].map((key) => ({
      type: USER_DELETED_WEBHOOK,
      data: { userId: fixtureId(`user:${key}`) },
    })),
    { type: USER_RESTORED_WEBHOOK, data: { userId: user(12) } },
    ...(['approved', 'rejected', 'approved', 'approved'] as const).map((decision, index) => ({
      type: APPROVAL_DECIDED_WEBHOOK,
      data: {
        approvalId: fixtureId(`approval:${index}`),
        approvalType: index % 2 === 0 ? 'user.register' : 'fileFolder.access',
        decision,
      },
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      type: FILE_UPLOADED_WEBHOOK,
      data: { fileId: fixtureId(`uploaded-file:${index}`), folderId: null },
    })),
  ];
  return plan
    .map((item, index) => {
      const daysAgo = random() * 9;
      return {
        id: fixtureId(`webhook-event:${index}`),
        type: item.type,
        data: item.data,
        occurredAt: ago(ctx.now, 0, daysAgo * 24),
        daysAgo,
      };
    })
    .toSorted((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

export interface WebhookFixtureResult {
  subscriptions: number;
  events: number;
  deliveries: number;
}

export async function seedWebhookFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
): Promise<WebhookFixtureResult> {
  // 與 api 相同的金鑰規則（modules/webhook/webhook.transport.ts）：`WEBHOOK_SECRET_KEY`，沒有時（僅開發）由 `JWT_SECRET` 推導
  if (!process.env.WEBHOOK_SECRET_KEY && !process.env.JWT_SECRET) {
    throw new Error('WEBHOOK_SECRET_KEY 或 JWT_SECRET 至少要設定一個，才能加密 webhook 的簽章密鑰');
  }
  const secrets = SecretBox.fromConfig(
    process.env.WEBHOOK_SECRET_KEY,
    process.env.JWT_SECRET ?? '',
    WEBHOOK_SECRET_PURPOSE,
  );
  const random = createRandom(20_261_007);
  const events = buildEvents(ctx, random);

  const subscriptionRows: (typeof webhookSubscriptions.$inferInsert)[] = [];
  const targetRows: (typeof webhookTargets.$inferInsert)[] = [];
  const deliveryRows: (typeof webhookDeliveries.$inferInsert)[] = [];

  for (const seed of SUBSCRIPTIONS) {
    const subscriptionId = fixtureId(`webhook:${seed.key}`);
    const types = new Set(seed.events.map((event) => event.type));
    const disabledAt = seed.disabled ? ago(ctx.now, seed.disabled.daysAgo) : null;
    const received = events.filter(
      (event) => types.has(event.type.type) && (!disabledAt || event.occurredAt < disabledAt),
    );
    let subscriptionLast: Date | null = null;

    for (const [urlIndex, url] of seed.urls.entries()) {
      const targetId = fixtureId(`webhook-target:${seed.key}:${urlIndex}`);
      let last: Date | null = null;
      let failures = 0;
      for (const [eventIndex, event] of received.entries()) {
        const attempts = seed.outcome(urlIndex, eventIndex, event.daysAgo);
        for (const [attemptIndex, outcome] of attempts.entries()) {
          // 第一次在事件後幾秒；重試間隔一分鐘起跳
          const createdAt = new Date(
            event.occurredAt.getTime() + 2000 + attemptIndex * 60_000 * 2 ** attemptIndex,
          );
          const succeeded = outcome.kind === 'ok';
          deliveryRows.push({
            id: fixtureId(`webhook-delivery:${seed.key}:${urlIndex}:${event.id}:${attemptIndex}`),
            subscriptionId,
            eventId: event.id,
            targetId,
            url,
            attempt: attemptIndex + 1,
            trigger: 'auto',
            succeeded,
            responseStatus: outcome.kind === 'error' ? null : outcome.status,
            durationMs:
              outcome.kind === 'error' && outcome.error === 'TIMEOUT'
                ? WEBHOOK_DELIVERY_TIMEOUT_MS
                : 60 + Math.floor(random() * 400),
            responseBody: responseBodyOf(outcome),
            error: outcome.kind === 'error' ? outcome.error : null,
            createdAt,
          });
          last = createdAt;
          failures = succeeded ? 0 : failures + 1;
        }
      }
      if (seed.disabled?.reason === 'failing') failures = WEBHOOK_AUTO_DISABLE_AFTER_FAILURES;
      targetRows.push({
        id: targetId,
        subscriptionId,
        url,
        position: urlIndex,
        consecutiveFailures: failures,
        lastDeliveryAt: last,
        createdAt: ago(ctx.now, 30),
      });
      if (last && (!subscriptionLast || last > subscriptionLast)) subscriptionLast = last;
    }

    subscriptionRows.push({
      id: subscriptionId,
      name: seed.name,
      events: seed.events.map((event) => event.type),
      status: seed.disabled ? 'disabled' : 'active',
      disabledReason: seed.disabled?.reason ?? null,
      secretEncrypted: secrets.encrypt(generateWebhookSecret()),
      lastDeliveryAt: subscriptionLast,
      // 手動停用是一次使用者的編輯；自動停用是系統改的，不遞增
      version: seed.disabled?.reason === 'manual' ? 2 : 1,
      createdAt: ago(ctx.now, 30),
      createdBy: ctx.actorId,
      updatedAt: disabledAt ?? ago(ctx.now, 30),
      updatedBy: seed.disabled?.reason === 'failing' ? null : ctx.actorId,
    });
  }

  await db.insert(webhookSubscriptions).values(subscriptionRows).onConflictDoNothing();
  await db.insert(webhookTargets).values(targetRows).onConflictDoNothing();
  await db
    .insert(webhookEvents)
    .values(
      events.map((event) => ({
        id: event.id,
        type: event.type.type,
        version: event.type.version,
        data: event.data,
        occurredAt: event.occurredAt,
      })),
    )
    .onConflictDoNothing();
  await db.insert(webhookDeliveries).values(deliveryRows).onConflictDoNothing();

  return {
    subscriptions: subscriptionRows.length,
    events: events.length,
    deliveries: deliveryRows.length,
  };
}

function responseBodyOf(outcome: Outcome): string | null {
  switch (outcome.kind) {
    case 'ok': {
      return outcome.status === 204 ? '' : '{"received":true}';
    }
    case 'http': {
      if (outcome.status === 503) return '{"error":"service unavailable"}';
      return outcome.status === 502 ? 'Bad Gateway' : 'Internal Server Error';
    }
    case 'error': {
      return null;
    }
  }
}
