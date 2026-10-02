import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { BroadcastService } from '../broadcast';
import { PermissionCacheService } from '../cache';
import { DomainEvent, DomainEventBus } from '../events';
import { requireTenant, Tenancy } from '../tenant';
import { AuthzRepository } from './authz.repository';

/** 平台 DB 上的廣播頻道。 */
export const AUTHZ_REVISION_CHANNEL = 'authz_revision';

interface RevisionMessage {
  tenant: string;
  revision: number;
}

function parse(payload: string): RevisionMessage | null {
  try {
    const value = JSON.parse(payload) as Partial<RevisionMessage>;
    return typeof value.tenant === 'string' && typeof value.revision === 'number'
      ? { tenant: value.tenant, revision: value.revision }
      : null;
  } catch {
    // 格式不對的訊息（不是這個版本送的）直接略過
    return null;
  }
}

/**
 * 關係圖的快取失效（docs/rbac/01-domain-model.md §9.2 D7、D8）：取代逐事件列出「要失效誰」。
 *
 * - 寫入 `relation_tuples` 的交易提交後，服務呼叫 `changed()`：本機立刻失效整個租戶的權限快取、
 *   發 `permissions.changed`（推播換 room），再把 `{ tenant, revision }` 廣播給其他程序。
 * - 收到廣播：只處理比已知新的 revision（自己送的、亂序晚到的都略過），失效那個租戶並在它的脈絡裡發事件。
 * - 監聽連線重連：中間可能漏了，整個權限快取丟掉；TTL 是漏掉廣播時的最後防線。
 */
@Injectable()
export class AuthzRevision implements OnModuleInit {
  private readonly logger = new Logger(AuthzRevision.name);
  /** 每個租戶已處理過的最新 revision；租戶數量級，不設上限。 */
  private readonly known = new Map<string, number>();

  constructor(
    private readonly repo: AuthzRepository,
    private readonly cache: PermissionCacheService,
    private readonly broadcast: BroadcastService,
    private readonly events: DomainEventBus,
    private readonly tenancy: Tenancy,
  ) {}

  onModuleInit(): void {
    this.broadcast.subscribe(AUTHZ_REVISION_CHANNEL, {
      onMessage: (payload) => this.onMessage(payload),
      onReconnect: () => this.cache.invalidateAll(),
    });
  }

  /**
   * 目前租戶的關係圖變了：在寫入的交易 **提交之後** 呼叫。
   * `userIds` 是已知直接受影響的人（例：被指派角色的人），只給需要逐人處理的訂閱者（補建個人資料夾）；
   * 快取與推播的 room 一律以整個租戶為單位。
   */
  async changed(userIds?: readonly string[]): Promise<void> {
    const tenantId = requireTenant().id;
    this.cache.invalidateTenant(tenantId);
    this.events.publish(DomainEvent.PERMISSIONS_CHANGED, userIds ? { userIds: [...userIds] } : {});

    let revision: number;
    try {
      revision = await this.repo.currentRevision();
    } catch (error) {
      // 本機已經失效；其他程序等 TTL
      this.logger.error({ err: error, tenantId }, '讀取關係圖的 revision 失敗，未廣播');
      return;
    }
    this.remember(tenantId, revision);
    await this.broadcast.publish(
      AUTHZ_REVISION_CHANNEL,
      JSON.stringify({ tenant: tenantId, revision } satisfies RevisionMessage),
    );
  }

  private async onMessage(payload: string): Promise<void> {
    const message = parse(payload);
    if (!message || !this.remember(message.tenant, message.revision)) return;
    this.cache.invalidateTenant(message.tenant);
    try {
      await this.tenancy.run(message.tenant, async () => {
        this.events.publish(DomainEvent.PERMISSIONS_CHANGED, {});
      });
    } catch (error) {
      // 租戶已停用或正在維護：快取已失效，推播的 room 不必同步（連線也已經或即將被斷掉）
      this.logger.debug({ err: error, tenant: message.tenant }, '略過推播的 room 同步');
    }
  }

  /** 比已知的新才記下並回傳 true；revision 單調遞增，舊的或重複的都不必處理。 */
  private remember(tenantId: string, revision: number): boolean {
    if (revision <= (this.known.get(tenantId) ?? -1)) return false;
    this.known.set(tenantId, revision);
    return true;
  }
}
