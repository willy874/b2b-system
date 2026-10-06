import { performance } from 'node:perf_hooks';

import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { Database } from '@/core/database';
import { deleteInBatches, TENANT_DB, withTransaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import { requireTenant } from '@/core/tenant';
import type { WebhookEventRow, WebhookSubscriptionRow, WebhookTargetRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';
import { PermissionService } from '@/modules/permission/permission.service';

import type { WebhookDeliveryTrigger } from './dto/webhook.dto';
import {
  WEBHOOK_AUTO_DISABLE_AFTER_FAILURES,
  WEBHOOK_CLEANUP_BATCH_SIZE,
  WEBHOOK_RETENTION_DAYS,
} from './webhook.constants';
import { WEBHOOK_DISABLED_NOTIFICATION, webhookDetailLink } from './webhook.notifications';
import { WebhookRepository } from './webhook.repository';
import type { WebhookDeliveryWithEvent } from './webhook.repository';
import { webhookHeaders } from './webhook.signature';
import type { WebhookEnvelope } from './webhook.signature';
import { WebhookTransport } from './webhook.transport';

/** `webhook.deliver` 的工作資料：只放 id（docs/architecture/backend/17-webhook.md §9.2 D9；`job:read` 的人看得到）。 */
export interface WebhookDeliverJobData {
  subscriptionId: string;
  eventId: string;
  /**
   * 送到哪個網址（docs/architecture/backend/17-webhook.md §10.2 D14）。升版前入列的工作沒有，
   * 送到訂閱的第一個網址（當時訂閱只有一個網址）。
   */
  targetId?: string;
}

/** 投遞失敗：拋給 pg-boss 依 `webhook.deliver` 的設定重試（D12）。訊息不含網址與回應內容。 */
export class WebhookDeliveryFailedError extends Error {
  constructor(
    readonly deliveryId: string,
    readonly reason: string,
  ) {
    super(`webhook 投遞失敗（${reason}）`);
  }
}

export interface WebhookCleanupReport {
  retentionDays: number;
  cutoff: string;
  deletedEvents: number;
}

/** 2xx 才算成功（D11）：3xx 不跟隨，也算失敗。 */
function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * 投遞（docs/architecture/backend/17-webhook.md §9.2 D11～D13、D16、D17）：背景工作 `webhook.deliver` 的 handler、
 * 送測試事件與重送的同步送出、保留清理。每一次嘗試寫一筆 `webhook_deliveries`。
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: WebhookRepository,
    private readonly transport: WebhookTransport,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly permissions: PermissionService,
    private readonly events: DomainEventBus,
  ) {}

  /**
   * `webhook.deliver` 的 handler。訂閱已刪除或停用、網址已被移除、事件已被清理、租戶關掉了 webhook：略過（不重試）。
   * 失敗就拋出讓 pg-boss 重試；這一次讓訂閱自動停用時不拋（之後的重試也只會被略過）。
   */
  async deliver(data: WebhookDeliverJobData): Promise<object> {
    if (!requireTenant().features.includes('webhook')) return { skipped: 'featureDisabled' };
    const subscription = await this.repo.findById(data.subscriptionId);
    if (!subscription || subscription.status !== 'active') return { skipped: 'inactive' };
    const target = data.targetId
      ? subscription.targets.find((item) => item.id === data.targetId)
      : subscription.targets[0];
    if (!target) return { skipped: 'targetRemoved' };
    const event = await this.repo.findEvent(data.eventId);
    if (!event) return { skipped: 'eventExpired' };

    const delivery = await this.attempt(subscription, target, event, 'auto');
    if (!delivery.succeeded && !delivery.disabledSubscription) {
      throw new WebhookDeliveryFailedError(
        delivery.id,
        delivery.error ?? `HTTP ${delivery.responseStatus}`,
      );
    }
    return {
      deliveryId: delivery.id,
      attempt: delivery.attempt,
      succeeded: delivery.succeeded,
      responseStatus: delivery.responseStatus,
      ...(delivery.disabledSubscription && { disabledSubscription: true }),
    };
  }

  /**
   * 送到一個網址並記錄。`auto`（投遞工作）：這個網址成功歸零、失敗加一，到門檻停用整個訂閱（D13、docs/architecture/backend/17-webhook.md §10.2 D15）。
   * `manual`（測試、重送，D17）：成功一樣歸零；失敗 **不** 計入門檻——使用者正在除錯，不該因為多按幾次就被停用。
   */
  async attempt(
    subscription: WebhookSubscriptionRow,
    target: WebhookTargetRow,
    event: WebhookEventRow,
    trigger: WebhookDeliveryTrigger,
  ): Promise<WebhookDeliveryWithEvent & { disabledSubscription: boolean }> {
    const attempt = (await this.repo.countAttempts(target.id, event.id)) + 1;
    const envelope: WebhookEnvelope = {
      id: event.id,
      type: event.type,
      version: event.version,
      occurredAt: event.occurredAt.toISOString(),
      tenant: requireTenant().code,
      data: event.data,
    };
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = this.transport.decryptSecret(subscription.secretEncrypted);

    const started = performance.now();
    const result = await this.transport.send(
      target.url,
      webhookHeaders(envelope, secret, timestamp, body),
      body,
    );
    const durationMs = Math.round(performance.now() - started);
    const succeeded = result.received && isSuccess(result.response.status);
    const at = new Date();
    const values = {
      subscriptionId: subscription.id,
      eventId: event.id,
      targetId: target.id,
      url: target.url,
      attempt,
      trigger,
      succeeded,
      responseStatus: result.received ? result.response.status : null,
      durationMs,
      responseBody: result.received ? result.response.body : null,
      error: result.received ? null : result.error,
    };

    // 可能停用：收件人在交易之前算好（docs/architecture/backend/15-notification.md §9）
    const mayDisable =
      trigger === 'auto' &&
      !succeeded &&
      target.consecutiveFailures + 1 >= WEBHOOK_AUTO_DISABLE_AFTER_FAILURES;
    const recipients = mayDisable
      ? await this.permissions.findActiveUserIdsWithPermission(PERMISSION.WEBHOOK_UPDATE)
      : [];

    const { delivery, disabledSubscription } = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.insertDelivery(values, tx);
      if (succeeded) {
        await this.repo.recordSuccess(subscription.id, target.id, at, tx);
        return { delivery: row, disabledSubscription: false };
      }
      if (trigger === 'manual') return { delivery: row, disabledSubscription: false };
      const failure = await this.repo.recordFailure(
        subscription.id,
        target.id,
        at,
        WEBHOOK_AUTO_DISABLE_AFTER_FAILURES,
        tx,
      );
      if (!failure?.disabledNow) return { delivery: row, disabledSubscription: false };
      await this.audit.record(
        {
          action: 'webhook.autoDisable',
          resourceType: RESOURCE_TYPE.WEBHOOK,
          resourceId: subscription.id,
          resourceName: subscription.name,
          changes: {
            before: { status: 'active' },
            after: { status: 'disabled', disabledReason: 'failing' },
          },
          metadata: { consecutiveFailures: failure.consecutiveFailures, url: target.url },
        },
        tx,
      );
      if (recipients.length) {
        await this.notifications.notify(
          recipients.map((recipientId) =>
            notification(WEBHOOK_DISABLED_NOTIFICATION, {
              recipientId,
              actorId: null,
              params: {
                webhookName: subscription.name,
                consecutiveFailures: failure.consecutiveFailures,
                url: target.url,
              },
              link: webhookDetailLink(subscription.id),
            }),
          ),
          tx,
        );
      }
      return { delivery: row, disabledSubscription: true };
    });

    if (disabledSubscription) {
      this.logger.warn(
        { webhookId: subscription.id, consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER_FAILURES },
        'webhook 連續失敗，已自動停用',
      );
    }
    this.publish(subscription.id, delivery.id, disabledSubscription);
    return {
      ...delivery,
      event: { type: event.type, data: event.data, occurredAt: event.occurredAt },
      disabledSubscription,
    };
  }

  /** 保留清理（D16）：刪掉超過保留天數的事件，投遞紀錄隨之刪除。分批各自提交。 */
  async cleanup(now: Date = new Date()): Promise<WebhookCleanupReport> {
    const cutoff = new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deletedEvents = await deleteInBatches(
      (size) => this.repo.deleteEventsBefore(cutoff, size),
      WEBHOOK_CLEANUP_BATCH_SIZE,
    );
    return { retentionDays: WEBHOOK_RETENTION_DAYS, cutoff: cutoff.toISOString(), deletedEvents };
  }

  /** 新的投遞紀錄；連帶訂閱的最後投遞時間與失敗次數（停用時是狀態）也變了。投遞不寫稽核（受眾表的 `recordsAudit: false`）。 */
  private publish(subscriptionId: string, deliveryId: string, disabled: boolean): void {
    const changes: ResourceChangeWire[] = [
      {
        resource: ChangeSource.WEBHOOK_DELIVERY,
        kind: ChangeKind.CREATE,
        id: deliveryId,
        refs: { [ChangeSource.WEBHOOK]: [subscriptionId] },
      },
    ];
    if (disabled) {
      changes.push({ resource: ChangeSource.WEBHOOK, kind: ChangeKind.UPDATE, id: subscriptionId });
    }
    this.events.publish(DomainEvent.RESOURCE_CHANGED, { changes });
  }
}
