import {
  coarsenChanges,
  limitChanges,
  MAX_CHANGES_PER_EVENT,
  ResourceChangeWireSchema,
  SessionRevokedReason,
} from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { BroadcastService, MAX_PAYLOAD_BYTES } from '../broadcast';
import type { BroadcastPublisher } from '../broadcast';
import { Tenancy } from '../tenant/tenancy.service';
import { currentTenant } from '../tenant/tenant-context';
import { DomainEvent } from './domain-events';
import type { DomainEventMeta, DomainEventPayloads } from './domain-events';
import { DomainEventBus } from './event-bus';

/** 平台 DB 上的廣播頻道。 */
export const DOMAIN_EVENT_CHANNEL = 'domain_event';

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

function fits(message: RelayMessage): boolean {
  return Buffer.byteLength(JSON.stringify(message)) <= MAX_MESSAGE_BYTES;
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
  if (type !== DomainEvent.RESOURCE_CHANGED && type !== DomainEvent.PLATFORM_CHANGED) {
    return payload;
  }
  const { changes } = payload as { changes: DomainEventPayloads['resource.changed']['changes'] };
  return { ...payload, changes: limitChanges(changes) };
}

/**
 * 放不進一則 `NOTIFY` 的事件拆成幾則：
 * - 資源變更：拿掉個別的 id（`id`、`refs`），退化成「這個來源全部失效」；受影響的人分批帶。
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
    const { changes, affectedUserIds = [] } =
      message.payload as DomainEventPayloads[typeof DomainEvent.RESOURCE_CHANGED];
    const coarse = coarsenChanges(changes);
    const userChunks = affectedUserIds.length ? chunk(affectedUserIds, IDS_PER_MESSAGE) : [[]];
    return userChunks.map((users) =>
      withPayload(users.length ? { changes: coarse, affectedUserIds: users } : { changes: coarse }),
    );
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

  constructor(
    private readonly bus: DomainEventBus,
    private readonly broadcast: BroadcastService,
    private readonly tenancy: Tenancy,
  ) {}

  onModuleInit(): void {
    this.publish = this.broadcast.channel(DOMAIN_EVENT_CHANNEL, {
      parse: parseMessage,
      onMessage: (message) => this.receive(message),
    });
    this.unsubscribers = RELAYED_EVENTS.map((type) =>
      this.bus.subscribe(type, (payload, meta) => this.forward(type, payload, meta)),
    );
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  private async forward<T extends RelayedEvent>(
    type: T,
    payload: DomainEventPayloads[T],
    meta: DomainEventMeta,
  ): Promise<void> {
    const publish = this.publish;
    if (!publish) return;
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
    for (const part of parts) {
      // oxlint-disable-next-line no-await-in-loop -- 依序送出，接收端照順序處理
      await publish(part);
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
