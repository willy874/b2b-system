import {
  coarsenChanges,
  limitChanges,
  MAX_CHANGES_PER_EVENT,
  ResourceChangeWireSchema,
  SessionRevokedReason,
} from '@b2b-system/realtime';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { BroadcastService, MAX_PAYLOAD_BYTES } from '../broadcast';
import type { BroadcastPublisher } from '../broadcast';
import { Tenancy } from '../tenant/tenancy.service';
import { currentTenant } from '../tenant/tenant-context';
import { DomainEvent } from './domain-events';
import type { DomainEventMeta, DomainEventPayloads, RecipientChanges } from './domain-events';
import { DomainEventBus, laneOf } from './event-bus';

/** 平台 DB 上的廣播頻道。 */
export const DOMAIN_EVENT_CHANNEL = 'domain_event';

/** `DomainEventRelay` 的選項（`EventsModule.sendOnly()` 提供；沒有提供時兩個方向都做）。 */
export const DOMAIN_EVENT_RELAY_OPTIONS = Symbol('DOMAIN_EVENT_RELAY_OPTIONS');

export interface DomainEventRelayOptions {
  /**
   * 是否 `LISTEN` 其他程序轉送來的事件。沒有 `{ remote: true }` 訂閱者的程序（對外 API：沒有推播）設 false，
   * 少一條監聽的連線、也不必解析每一則（docs/architecture/backend/08-realtime.md §7.6）。
   */
  receive: boolean;
}

/**
 * 等著送出的轉送訊息上限（整個程序）。超過時略過新的事件並記一筆 warn：推播只是加速，
 * 與其讓記憶體無限成長，不如讓前端在下一次重抓時看到新資料。
 */
const MAX_PENDING_MESSAGES = 1000;

/**
 * 轉送哪些事件：只有「每個程序都要對自己的連線做一次」的推播。
 * - `permissions.changed` 不在這裡：`AuthzRevision` 已經以 revision 廣播並在收到的程序重新發佈。
 * - `tenant.activated` 不在這裡：訂閱者（補系統資料夾）寫資料庫，整個系統做一次就夠。
 */
const RELAYED_EVENTS = [
  DomainEvent.RESOURCE_CHANGED,
  DomainEvent.SESSIONS_REVOKED,
  DomainEvent.TENANT_FEATURES_CHANGED,
  DomainEvent.PLATFORM_CHANGED,
] as const;

type RelayedEvent = (typeof RELAYED_EVENTS)[number];

const IdSchema = z.string().min(1).max(64);
const IdListSchema = z.array(IdSchema);

/** 收到時依事件驗證 payload：送出端是同一份程式，但不同版本並存（滾動部署）時格式可能對不上。 */
const PAYLOAD_SCHEMAS: { [T in RelayedEvent]: z.ZodType<DomainEventPayloads[T]> } = {
  [DomainEvent.RESOURCE_CHANGED]: z.object({
    changes: z.array(ResourceChangeWireSchema).max(MAX_CHANGES_PER_EVENT),
    affectedUserIds: IdListSchema.optional(),
    perRecipient: z
      .array(
        z.object({
          userId: IdSchema,
          changes: z.array(ResourceChangeWireSchema).max(MAX_CHANGES_PER_EVENT),
        }),
      )
      .optional(),
  }),
  [DomainEvent.SESSIONS_REVOKED]: z.object({
    userIds: IdListSchema.optional(),
    idpSessionUids: IdListSchema.optional(),
    tenantIds: IdListSchema.optional(),
    platformAdminIds: IdListSchema.optional(),
    reason: z.enum(SessionRevokedReason),
  }),
  [DomainEvent.TENANT_FEATURES_CHANGED]: z.object({ tenantId: IdSchema }),
  [DomainEvent.PLATFORM_CHANGED]: z.object({
    changes: z.array(ResourceChangeWireSchema).max(MAX_CHANGES_PER_EVENT),
    adminIds: IdListSchema.optional(),
  }),
};

interface RelayMessage<T extends RelayedEvent = RelayedEvent> {
  type: T;
  /** 發佈當下的租戶；null：平台層級（沒有租戶脈絡）的事件。 */
  tenant: string | null;
  payload: DomainEventPayloads[T];
  occurredAt: string;
  clientId?: string;
  requestId?: string;
}

const MessageSchema = z.object({
  type: z.enum(RELAYED_EVENTS),
  tenant: IdSchema.nullable(),
  payload: z.unknown(),
  occurredAt: z.iso.datetime(),
  clientId: z.string().max(64).optional(),
  requestId: z.string().max(128).optional(),
});

function parseMessage(value: unknown): RelayMessage | null {
  const envelope = MessageSchema.safeParse(value);
  if (!envelope.success) return null;
  const payload = PAYLOAD_SCHEMAS[envelope.data.type].safeParse(envelope.data.payload);
  // 型別與 payload 各自驗過；TS 推不出兩者對應（`type` 是聯集），在這裡收斂
  return payload.success ? ({ ...envelope.data, payload: payload.data } as RelayMessage) : null;
}

/** 信封（`{"o":"<uuid>","m":…}`）之外，訊息本身最多佔多少位元組；留一點餘裕。 */
const MAX_MESSAGE_BYTES = MAX_PAYLOAD_BYTES - 200;
/** 拆開時每則最多帶幾個 id：uuid 36 字元，150 個約 6 KB。 */
const IDS_PER_MESSAGE = 150;

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function fits(message: RelayMessage): boolean {
  return bytesOf(message) <= MAX_MESSAGE_BYTES;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * 接收端以合約的上限驗證 `changes`（`PAYLOAD_SCHEMAS`）：放得進一則 `NOTIFY`、但超過 100 筆（或 `refs` 過長）的事件
 * 送過去會被整則拒收，所以轉送前先套用 `limitChanges`，與推播給客戶端時同一個規則（docs/architecture/backend/08-realtime.md §9）。
 */
function withinChangeLimit<T extends RelayedEvent>(
  type: T,
  payload: DomainEventPayloads[T],
): DomainEventPayloads[T] {
  if (type === DomainEvent.RESOURCE_CHANGED) {
    const { perRecipient, ...rest } =
      payload as DomainEventPayloads[typeof DomainEvent.RESOURCE_CHANGED];
    return {
      ...rest,
      changes: limitChanges(rest.changes),
      ...(perRecipient && {
        perRecipient: perRecipient.map(({ userId, changes }) => ({
          userId,
          changes: limitChanges(changes),
        })),
      }),
    } as DomainEventPayloads[T];
  }
  if (type === DomainEvent.PLATFORM_CHANGED) {
    const platform = payload as DomainEventPayloads[typeof DomainEvent.PLATFORM_CHANGED];
    return { ...platform, changes: limitChanges(platform.changes) } as DomainEventPayloads[T];
  }
  return payload;
}

/**
 * `perRecipient` 依位元組裝成幾則：每則盡量多帶幾個人（`changes` 是空的）。一個人的變更自己就放不進一則時，
 * 改成不帶 id 的版本（`coarsenChanges`）——收件人重抓自己的那一類資料。
 */
function packRecipients(
  recipients: readonly RecipientChanges[],
  withPayload: (payload: RelayMessage['payload']) => RelayMessage,
): RelayMessage[] {
  const emptyBytes = bytesOf(withPayload({ changes: [], perRecipient: [] }));
  const parts: RelayMessage[] = [];
  let batch: RecipientChanges[] = [];
  let bytes = emptyBytes;
  for (const recipient of recipients) {
    let entry = recipient;
    // 陣列裡每一個元素另外多一個逗號
    let size = bytesOf(entry) + 1;
    if (emptyBytes + size > MAX_MESSAGE_BYTES) {
      entry = { userId: recipient.userId, changes: coarsenChanges(recipient.changes) };
      size = bytesOf(entry) + 1;
    }
    if (batch.length && bytes + size > MAX_MESSAGE_BYTES) {
      parts.push(withPayload({ changes: [], perRecipient: batch }));
      batch = [];
      bytes = emptyBytes;
    }
    batch.push(entry);
    bytes += size;
  }
  if (batch.length) parts.push(withPayload({ changes: [], perRecipient: batch }));
  return parts;
}

/**
 * 放不進一則 `NOTIFY` 的事件拆成幾則：
 * - 資源變更：`perRecipient` 依位元組裝成幾則（每個人的 id 照帶）；共用的 `changes` 放得進就原樣一則，放不進才拿掉個別的 id
 *   （`id`、`refs`），退化成「這個來源全部失效」，受影響的人分批帶。
 * - 撤銷連線：名單分批。
 */
function split(message: RelayMessage): RelayMessage[] {
  if (fits(message)) return [message];
  const withPayload = (payload: RelayMessage['payload']): RelayMessage => ({
    type: message.type,
    tenant: message.tenant,
    payload,
    occurredAt: message.occurredAt,
    clientId: message.clientId,
    requestId: message.requestId,
  });

  if (message.type === DomainEvent.RESOURCE_CHANGED) {
    const {
      changes,
      affectedUserIds = [],
      perRecipient = [],
    } = message.payload as DomainEventPayloads[typeof DomainEvent.RESOURCE_CHANGED];
    const parts: RelayMessage[] = [];
    if (changes.length) {
      const shared = withPayload(
        affectedUserIds.length ? { changes, affectedUserIds } : { changes },
      );
      if (fits(shared)) {
        parts.push(shared);
      } else {
        const coarse = coarsenChanges(changes);
        const userChunks = affectedUserIds.length ? chunk(affectedUserIds, IDS_PER_MESSAGE) : [[]];
        parts.push(
          ...userChunks.map((users) =>
            withPayload(
              users.length ? { changes: coarse, affectedUserIds: users } : { changes: coarse },
            ),
          ),
        );
      }
    }
    parts.push(...packRecipients(perRecipient, withPayload));
    return parts;
  }

  if (message.type === DomainEvent.SESSIONS_REVOKED) {
    const { reason, ...lists } =
      message.payload as DomainEventPayloads[typeof DomainEvent.SESSIONS_REVOKED];
    return (['userIds', 'idpSessionUids', 'tenantIds', 'platformAdminIds'] as const).flatMap(
      (field) =>
        chunk(lists[field] ?? [], IDS_PER_MESSAGE).map((ids) =>
          withPayload({ reason, [field]: ids }),
        ),
    );
  }

  if (message.type === DomainEvent.PLATFORM_CHANGED) {
    const { changes, adminIds = [] } =
      message.payload as DomainEventPayloads[typeof DomainEvent.PLATFORM_CHANGED];
    const coarse = coarsenChanges(changes);
    const adminChunks = adminIds.length ? chunk(adminIds, IDS_PER_MESSAGE) : [[]];
    return adminChunks.map((admins) =>
      withPayload(admins.length ? { changes: coarse, adminIds: admins } : { changes: coarse }),
    );
  }

  // 其餘事件的 payload 是固定的小物件
  return [message];
}

/**
 * 領域事件的跨程序轉送（docs/architecture/06-external-api.md §9.2 D18）：
 *
 * - 本機發佈的推播類事件（`RELAYED_EVENTS`）經平台 DB 的 `NOTIFY` 送給其他程序；
 *   對外 API、之後拆出的 worker 寫入的資料，連在 api 上的使用者才收得到推播。
 * - 收到的事件在發佈端的租戶脈絡裡以 `deliverRemote` 交給本機的 bus，只到 `{ remote: true }` 的訂閱者，
 *   不會再轉送出去（轉送只訂閱本機發佈的事件）。
 * - 與 `DomainEventBus` 同樣不保證送達：推播只送訊號，前端重新連線時本來就會重抓。
 */
@Injectable()
export class DomainEventRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventRelay.name);
  private publish?: BroadcastPublisher<RelayMessage>;
  private unsubscribers: Array<() => void> = [];
  /** 每條佇列（與 bus 的佇列對應：每個租戶一條、另加優先通道）等著送出的訊息；送完就移除。 */
  private readonly outboxes = new Map<string, RelayMessage[]>();
  /** 每條佇列正在送的那一輪。 */
  private readonly senders = new Map<string, Promise<void>>();
  private pendingCount = 0;

  constructor(
    private readonly bus: DomainEventBus,
    private readonly broadcast: BroadcastService,
    private readonly tenancy: Tenancy,
    @Optional()
    @Inject(DOMAIN_EVENT_RELAY_OPTIONS)
    private readonly options: DomainEventRelayOptions = { receive: true },
  ) {}

  onModuleInit(): void {
    this.publish = this.options.receive
      ? this.broadcast.channel(DOMAIN_EVENT_CHANNEL, {
          parse: parseMessage,
          onMessage: (message) => this.receive(message),
        })
      : this.broadcast.sender<RelayMessage>(DOMAIN_EVENT_CHANNEL);
    this.unsubscribers = RELAYED_EVENTS.map((type) =>
      this.bus.subscribe(type, (payload, meta) => this.forward(type, payload, meta)),
    );
  }

  /** 等到目前排著的轉送訊息都送出。供測試使用。 */
  async idle(): Promise<void> {
    while (this.senders.size > 0) {
      // oxlint-disable-next-line no-await-in-loop -- 送的期間可能又排進新的訊息
      await Promise.all(this.senders.values());
    }
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  /**
   * 交給送出佇列就返回，不等 `NOTIFY`：bus 的佇列（同一個租戶的推播）不必排在平台 DB 的往返後面
   * （docs/architecture/backend/08-realtime.md §7.6）。同一條佇列依序送出，接收端照順序處理。
   */
  private forward<T extends RelayedEvent>(
    type: T,
    payload: DomainEventPayloads[T],
    meta: DomainEventMeta,
  ): void {
    if (!this.publish) return;
    const message: RelayMessage<T> = {
      type,
      tenant: currentTenant()?.id ?? null,
      payload: withinChangeLimit(type, payload),
      occurredAt: meta.occurredAt.toISOString(),
      ...(meta.clientId ? { clientId: meta.clientId } : {}),
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    };
    const parts = split(message);
    if (parts.length > 1) {
      this.logger.debug({ event: type, parts: parts.length }, '轉送的事件超過一則廣播，拆開送出');
    }
    this.enqueue(laneOf(type), parts);
  }

  private enqueue(lane: string, parts: readonly RelayMessage[]): void {
    if (this.pendingCount + parts.length > MAX_PENDING_MESSAGES) {
      this.logger.warn(
        { lane, pending: this.pendingCount, dropped: parts.length },
        '轉送的佇列已滿，略過這則事件',
      );
      return;
    }
    const queue = this.outboxes.get(lane) ?? [];
    queue.push(...parts);
    this.outboxes.set(lane, queue);
    this.pendingCount += parts.length;
    if (!this.senders.has(lane)) this.senders.set(lane, this.send(lane, queue));
  }

  /** 一條佇列依序送到空為止；送的期間排進來的也在這一輪送出。 */
  private async send(lane: string, queue: RelayMessage[]): Promise<void> {
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        this.pendingCount -= 1;
        try {
          // oxlint-disable-next-line no-await-in-loop -- 依序送出，接收端照順序處理
          await this.publish?.(next);
        } catch (error) {
          // 送出失敗只記錄（廣播是加速）；這一則略過，後面的照送
          this.logger.error({ err: error, event: next.type }, '轉送事件失敗');
        }
      }
    } finally {
      this.outboxes.delete(lane);
      this.senders.delete(lane);
    }
  }

  private async receive(message: RelayMessage): Promise<void> {
    const deliver = (): void =>
      this.bus.deliverRemote(message.type, message.payload, {
        occurredAt: new Date(message.occurredAt),
        clientId: message.clientId,
        requestId: message.requestId,
      });
    if (message.tenant === null) {
      deliver();
      return;
    }
    try {
      await this.tenancy.run(message.tenant, async () => deliver());
    } catch (error) {
      // 租戶已停用或正在維護：它的連線已經或即將被斷掉，不必推播
      this.logger.debug({ err: error, tenant: message.tenant }, '略過轉送來的事件');
    }
  }
}
