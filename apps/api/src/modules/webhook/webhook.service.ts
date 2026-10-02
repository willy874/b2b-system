import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import type { PaginatedResult } from '@/core/http';
import { JobQueue } from '@/core/jobs';
import { RESOURCE_TYPE } from '@/core/resource';
import { requireTenant, tenantFeatureParam, WEBHOOK_MAX_URLS_PARAM } from '@/core/tenant';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';

import type {
  CreatedWebhookDto,
  CreateWebhookDto,
  ListWebhookDeliveryDto,
  ListWebhookDto,
  UpdateWebhookDto,
  WebhookDeliveryDto,
  WebhookDto,
  WebhookEventListDto,
  WebhookSecretDto,
  WebhookTestResultDto,
} from './dto/webhook.dto';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookEventCatalog } from './webhook-event.catalog';
import {
  WEBHOOK_AUDIT_FIELDS,
  WEBHOOK_MAX_SUBSCRIPTIONS,
  WEBHOOK_PING_EVENT,
} from './webhook.constants';
import type { WebhookData, WebhookEventType } from './webhook.definition';
import { WEBHOOK_DELIVER_JOB } from './webhook.jobs';
import type {
  WebhookDeliveryWithEvent,
  WebhookSubscriptionWithCreator,
} from './webhook.repository';
import { WebhookRepository } from './webhook.repository';
import { generateWebhookSecret } from './webhook.signature';
import { WebhookTransport } from './webhook.transport';

function toDto(row: WebhookSubscriptionWithCreator, catalog: WebhookEventCatalog): WebhookDto {
  return {
    id: row.id,
    name: row.name,
    targets: row.targets.map((target) => ({
      id: target.id,
      url: target.url,
      consecutiveFailures: target.consecutiveFailures,
      lastDeliveryAt: target.lastDeliveryAt?.toISOString() ?? null,
    })),
    // 目錄上已經沒有的事件（程式移除了）不列出，也不會再發出
    events: row.events.filter((event) => catalog.isSubscribable(event)),
    status: row.status === 'disabled' ? 'disabled' : 'active',
    disabledReason:
      row.disabledReason === 'manual' || row.disabledReason === 'failing'
        ? row.disabledReason
        : null,
    consecutiveFailures: Math.max(0, ...row.targets.map((target) => target.consecutiveFailures)),
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.creator,
  };
}

function toDeliveryDto(row: WebhookDeliveryWithEvent): WebhookDeliveryDto {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.event.type,
    eventData: row.event.data,
    occurredAt: row.event.occurredAt.toISOString(),
    targetId: row.targetId,
    url: row.url,
    attempt: row.attempt,
    trigger: row.trigger === 'manual' ? 'manual' : 'auto',
    succeeded: row.succeeded,
    responseStatus: row.responseStatus,
    durationMs: row.durationMs,
    responseBody: row.responseBody,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 稽核用的快照：只比使用者能改的欄位（密鑰不進稽核）。 */
function auditView(row: { name: string; urls: string[]; events: string[]; status: string }) {
  return { name: row.name, urls: row.urls, events: row.events, status: row.status };
}

function urlsOf(row: WebhookSubscriptionWithCreator): string[] {
  return row.targets.map((target) => target.url);
}

/**
 * Webhook（docs/architecture/backend/17-webhook.md §9）：訂閱的增刪改、密鑰輪替、送測試事件、重送，
 * 以及擁有者模組在業務交易內呼叫的 `emit()`。
 */
@Injectable()
export class WebhookService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: WebhookRepository,
    private readonly catalog: WebhookEventCatalog,
    private readonly deliveries: WebhookDeliveryService,
    private readonly transport: WebhookTransport,
    private readonly jobs: JobQueue,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  // ── 發出事件（擁有者模組呼叫） ──────────────────────────

  /**
   * 在擁有者的業務交易內（稽核之後）發出一個對外事件（D9）：有訂閱就寫一筆事件、每個訂閱的每個網址入列一筆投遞工作
   * （docs/architecture/backend/17-webhook.md §10.2 D14），
   * 與業務資料一起提交或一起回滾。沒有訂閱、或租戶關掉了 webhook（D8）時什麼都不寫。
   */
  async emit<D extends WebhookData>(
    event: WebhookEventType<D>,
    data: D,
    tx: Transaction,
  ): Promise<void> {
    this.catalog.assertRegistered(event.type);
    if (!requireTenant().features.includes('webhook')) return;
    const targets = await this.repo.findActiveTargetsByEvent(event.type, tx);
    if (!targets.length) return;
    const row = await this.repo.insertEvent({ type: event.type, version: event.version, data }, tx);
    for (const { subscriptionId, targetId } of targets) {
      // oxlint-disable-next-line no-await-in-loop -- 同一個交易內依序寫 outbox
      await this.jobs.enqueue(
        WEBHOOK_DELIVER_JOB,
        { subscriptionId, eventId: row.id, targetId },
        { tx },
      );
    }
  }

  // ── 訂閱 ─────────────────────────────────────────────

  async list(query: ListWebhookDto): Promise<PaginatedResult<WebhookDto>> {
    const { items, total } = await this.repo.list(query);
    return paginated(
      items.map((row) => toDto(row, this.catalog)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<WebhookDto> {
    return toDto(await this.getExisting(id), this.catalog);
  }

  /** 訂閱頁可以選的事件：可訂閱、所屬 feature 已啟用。 */
  listEvents(): WebhookEventListDto {
    const features = requireTenant().features;
    return {
      items: this.catalog
        .subscribable(features)
        .map((event) => ({ type: event.type, version: event.version })),
    };
  }

  async create(dto: CreateWebhookDto, actor: AuthUser): Promise<CreatedWebhookDto> {
    this.assertEvents(dto.events);
    const urls = await this.normalizeUrls(dto.urls);
    const secret = generateWebhookSecret();
    const created = await withTransaction(this.db, async (tx) => {
      await this.repo.lockForCount(tx);
      if ((await this.repo.countAll(tx)) >= WEBHOOK_MAX_SUBSCRIPTIONS) {
        throw new AppException('WEBHOOK_LIMIT_REACHED', { max: WEBHOOK_MAX_SUBSCRIPTIONS });
      }
      await this.assertUrlLimit(urls, tx);
      const row = await this.repo.create(
        {
          name: dto.name,
          // 升版期間的舊程式碼還讀這一欄（docs/architecture/backend/17-webhook.md §10.2 D12 的雙寫）
          url: urls[0],
          events: dto.events,
          secretEncrypted: this.transport.encryptSecret(secret),
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      await this.repo.replaceTargets(row.id, urls, tx);
      await this.audit.record(
        {
          action: 'webhook.create',
          resourceType: RESOURCE_TYPE.WEBHOOK,
          resourceId: row.id,
          resourceName: row.name,
          changes: { after: auditView({ ...row, urls }) },
        },
        tx,
      );
      return row;
    });
    this.publish(ChangeKind.CREATE, created.id);
    return { secret, webhook: await this.findOne(created.id) };
  }

  /** 改名、網址、事件、停用與啟用。啟用時所有網址的失敗次數歸零（D13、docs/architecture/backend/17-webhook.md §10.2 D15）。 */
  async update(id: string, dto: UpdateWebhookDto, actor: AuthUser): Promise<WebhookDto> {
    const current = await this.getExisting(id);
    if (dto.version !== current.version) {
      throw new AppException('WEBHOOK_VERSION_CONFLICT', { current: current.version });
    }
    if (dto.events) this.assertEvents(dto.events);
    const urls = dto.urls !== undefined ? await this.normalizeUrls(dto.urls) : undefined;
    const statusChange = dto.status !== undefined && dto.status !== current.status;
    const enabling = statusChange && dto.status === 'active';
    const values = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(urls !== undefined && { url: urls[0] }),
      ...(dto.events !== undefined && { events: dto.events }),
      ...(enabling ? { status: 'active', disabledReason: null } : {}),
      ...(statusChange && dto.status === 'disabled'
        ? { status: 'disabled', disabledReason: 'manual' }
        : {}),
      updatedBy: actor.id,
    };
    await withTransaction(this.db, async (tx) => {
      if (urls) {
        await this.repo.lockForCount(tx);
        await this.assertUrlLimit(urls, tx, id);
      }
      const row = await this.repo.update(id, values, dto.version, tx);
      if (!row) {
        const latest = await this.repo.findById(id, tx);
        throw latest
          ? new AppException('WEBHOOK_VERSION_CONFLICT', { current: latest.version })
          : new AppException('WEBHOOK_NOT_FOUND');
      }
      if (urls) await this.repo.replaceTargets(id, urls, tx);
      if (enabling) await this.repo.resetTargetFailures(id, tx);
      const changes = diff(
        auditView({ ...current, urls: urlsOf(current) }),
        auditView({ ...row, urls: urls ?? urlsOf(current) }),
        WEBHOOK_AUDIT_FIELDS,
      );
      if (changes) {
        await this.audit.record(
          {
            action: 'webhook.update',
            resourceType: RESOURCE_TYPE.WEBHOOK,
            resourceId: id,
            resourceName: row.name,
            changes,
          },
          tx,
        );
      }
    });
    this.publish(ChangeKind.UPDATE, id);
    return this.findOne(id);
  }

  /** 硬刪除（D7）：投遞紀錄一併刪除；已入列的投遞在執行時看到訂閱不在就略過。 */
  async remove(id: string): Promise<void> {
    const current = await this.getExisting(id);
    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.delete(id, tx))) throw new AppException('WEBHOOK_NOT_FOUND');
      await this.audit.record(
        {
          action: 'webhook.delete',
          resourceType: RESOURCE_TYPE.WEBHOOK,
          resourceId: id,
          resourceName: current.name,
          changes: { before: auditView({ ...current, urls: urlsOf(current) }) },
        },
        tx,
      );
    });
    this.publish(ChangeKind.DELETE, id);
  }

  /** 輪替密鑰（D14）：新的立即生效、舊的立即失效；新密鑰只在這個回應出現一次。 */
  async rotateSecret(id: string, actor: AuthUser): Promise<WebhookSecretDto> {
    const current = await this.getExisting(id);
    const secret = generateWebhookSecret();
    await withTransaction(this.db, async (tx) => {
      const row = await this.repo.replaceSecret(
        id,
        this.transport.encryptSecret(secret),
        actor.id,
        tx,
      );
      if (!row) throw new AppException('WEBHOOK_NOT_FOUND');
      await this.audit.record(
        {
          action: 'webhook.rotateSecret',
          resourceType: RESOURCE_TYPE.WEBHOOK,
          resourceId: id,
          resourceName: current.name,
        },
        tx,
      );
    });
    this.publish(ChangeKind.UPDATE, id);
    return { secret, webhook: await this.findOne(id) };
  }

  // ── 投遞 ─────────────────────────────────────────────

  async listDeliveries(
    id: string,
    query: ListWebhookDeliveryDto,
  ): Promise<PaginatedResult<WebhookDeliveryDto>> {
    await this.getExisting(id);
    const { items, total } = await this.repo.listDeliveries(id, query);
    return paginated(items.map(toDeliveryDto), total, query);
  }

  /**
   * 送測試事件（D17）：同步送出 `webhook.ping` 到 **每個網址**，回傳每個網址的投遞紀錄
   * （docs/architecture/backend/17-webhook.md §10.2 D16）。各網址同時送出，一個慢的不拖住其他的。
   */
  async sendTest(id: string): Promise<WebhookTestResultDto> {
    const subscription = await this.getActive(id);
    const event = await this.repo.insertEvent(
      {
        type: WEBHOOK_PING_EVENT.type,
        version: WEBHOOK_PING_EVENT.version,
        data: { webhookId: id },
      },
      this.db,
    );
    const deliveries = await Promise.all(
      subscription.targets.map((target) =>
        this.deliveries.attempt(subscription, target, event, 'manual'),
      ),
    );
    return { items: deliveries.map(toDeliveryDto) };
  }

  /**
   * 手動重送某一筆紀錄的事件到 **同一個網址**（D17、docs/architecture/backend/17-webhook.md §10.2 D16）：事件 id 不變，接收端可以據此去重。
   * 網址已從訂閱移除時當作紀錄不存在。
   */
  async redeliver(id: string, deliveryId: string): Promise<WebhookDeliveryDto> {
    const subscription = await this.getActive(id);
    const delivery = await this.repo.findDelivery(id, deliveryId);
    const target = delivery?.targetId
      ? subscription.targets.find((item) => item.id === delivery.targetId)
      : undefined;
    const event = delivery && target && (await this.repo.findEvent(delivery.eventId));
    if (!target || !event) throw new AppException('WEBHOOK_DELIVERY_NOT_FOUND');
    return toDeliveryDto(await this.deliveries.attempt(subscription, target, event, 'manual'));
  }

  // ── 業務規則 ─────────────────────────────────────────

  private async getExisting(id: string): Promise<WebhookSubscriptionWithCreator> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppException('WEBHOOK_NOT_FOUND');
    return row;
  }

  private async getActive(id: string): Promise<WebhookSubscriptionWithCreator> {
    const row = await this.getExisting(id);
    if (row.status !== 'active') throw new AppException('WEBHOOK_DISABLED');
    return row;
  }

  /** 每個網址各自檢查（D15）；正規化之後相同的網址只留一個。 */
  private async normalizeUrls(urls: readonly string[]): Promise<string[]> {
    const normalized = await Promise.all(urls.map((url) => this.transport.normalizeUrl(url)));
    return [...new Set(normalized)];
  }

  /**
   * 整個租戶不重複的網址數上限 `webhook.maxUrls`（docs/architecture/05-tenancy.md §13.3 D11）：
   * 變更後超過上限 **而且比變更前多** 才擋——升版前已經超過的租戶仍能修改與減少。呼叫前先 `lockForCount`。
   */
  private async assertUrlLimit(urls: string[], tx: DbOrTx, subscriptionId?: string): Promise<void> {
    const max = tenantFeatureParam(WEBHOOK_MAX_URLS_PARAM);
    const [all, others] = await Promise.all([
      this.repo.distinctUrls(tx),
      subscriptionId ? this.repo.distinctUrls(tx, subscriptionId) : undefined,
    ]);
    const after = new Set([...(others ?? all), ...urls]).size;
    if (after > max && after > all.length) {
      throw new AppException('WEBHOOK_URL_LIMIT_REACHED', { max });
    }
  }

  /** 只能訂閱目錄上可訂閱的事件（不看 feature：存的是名稱，feature 打開時就會送）。 */
  private assertEvents(events: readonly string[]): void {
    const unknown = events.filter((event) => !this.catalog.isSubscribable(event));
    if (unknown.length) throw new AppException('WEBHOOK_EVENT_UNKNOWN', { events: unknown });
  }

  private publish(kind: ChangeKind, id: string): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.WEBHOOK, kind, id }],
    });
  }
}
