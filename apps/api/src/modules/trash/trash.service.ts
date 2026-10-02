import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException, isForeignKeyViolation } from '@/core/errors';
import { paginated } from '@/core/http';
import type { PaginatedResult } from '@/core/http';
import { SettingService } from '@/core/settings';
import { currentTenant } from '@/core/tenant';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import type { ListTrashDto, TrashItemDto } from './dto/trash.dto';
import { TRASH_PURGE_BATCH_SIZE } from './trash.constants';
import type { TrashResourceType } from './trash.constants';
import { TrashRegistry } from './trash.registry';
import { TRASH_RETENTION_DAYS_SETTING } from './trash.settings';
import type { ExpiredTrashItem, TrashHandler, TrashItem } from './trash.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 一輪永久刪除的結果（存成背景工作的 `output`）。 */
export interface TrashPurgeReport {
  retentionDays: number;
  /** 刪除時間早於它的列才會被永久刪除。 */
  cutoff: string;
  /** 各類型永久刪除的筆數。 */
  purged: Partial<Record<TrashResourceType, number>>;
  /** 各類型到期但這一輪略過的筆數（仍被外鍵參照、或在這一輪之間被還原）；下一輪再試。 */
  skipped: Partial<Record<TrashResourceType, number>>;
}

function toDto(type: TrashResourceType, item: TrashItem, retentionDays: number): TrashItemDto {
  return {
    id: item.id,
    type,
    name: item.name,
    description: item.description,
    deletedAt: item.deletedAt.toISOString(),
    deletedBy: item.deletedBy,
    purgeAt: new Date(item.deletedAt.getTime() + retentionDays * DAY_MS).toISOString(),
  };
}

/**
 * 回收桶（docs/architecture/backend/13-trash.md、docs/architecture/backend/14-revisions.md §9.2 D9～D11）：列出已刪除的項目、到期永久刪除。
 * 各類型的查詢、硬刪除與連帶處理交給擁有資源的模組註冊的 `TrashHandler`；還原端點也在擁有者那裡。
 */
@Injectable()
export class TrashService {
  private readonly logger = new Logger(TrashService.name);

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly registry: TrashRegistry,
    private readonly permissionService: PermissionService,
    private readonly settings: SettingService,
    private readonly audit: AuditService,
  ) {}

  /** 擁有資源的模組在 `onModuleInit` 呼叫，登記自己的回收桶。 */
  registerHandler(handler: TrashHandler): void {
    this.registry.register(handler);
  }

  async list(query: ListTrashDto, actor: AuthUser): Promise<PaginatedResult<TrashItemDto>> {
    const handler = this.registry.get(query.type);
    // 先看 feature 再看權限：與 FeatureGuard 排在 PermissionsGuard 之前同一個理由（功能沒開時一律 404，不寫 authz.denied）
    this.assertFeatureEnabled(handler);
    await this.assertCanView(handler, actor);
    const [{ items, total }, retentionDays] = await Promise.all([
      handler.listDeleted(query),
      this.settings.get(TRASH_RETENTION_DAYS_SETTING),
    ]);
    return paginated(
      items.map((item) => toDto(handler.type, item, retentionDays)),
      total,
      query,
    );
  }

  /**
   * 到期的列依 `purgeOrder` 逐類永久刪除（docs/architecture/backend/14-revisions.md §9.2 D11）。每批一個交易、每一列一個 savepoint：
   * 一列因外鍵刪不掉只略過它自己，同一批的其他列照常刪除；稽核 `<resource>.purge` 與刪除同生共死。
   */
  async purgeExpired(now: Date = new Date()): Promise<TrashPurgeReport> {
    const retentionDays = await this.settings.get(TRASH_RETENTION_DAYS_SETTING);
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    const report: TrashPurgeReport = {
      retentionDays,
      cutoff: cutoff.toISOString(),
      purged: {},
      skipped: {},
    };

    for (const handler of this.registry.inPurgeOrder()) {
      let afterId: string | null = null;
      let purged = 0;
      let skipped = 0;
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- keyset 分頁：下一批從這一批的最後一筆之後開始
        const batch = await handler.findExpired(cutoff, afterId, TRASH_PURGE_BATCH_SIZE);
        if (batch.length === 0) break;
        // oxlint-disable-next-line no-await-in-loop -- 每批一個交易，依序執行
        const ids = await withTransaction(this.db, (tx) =>
          this.purgeBatch(handler, batch, retentionDays, tx),
        );
        purged += ids.length;
        skipped += batch.length - ids.length;
        // oxlint-disable-next-line no-await-in-loop -- 提交之後才做副作用（快取失效、推播）
        if (ids.length > 0) await handler.afterPurge(ids);
        afterId = batch.at(-1)?.id ?? null;
        if (batch.length < TRASH_PURGE_BATCH_SIZE) break;
      }
      if (purged > 0) report.purged[handler.type] = purged;
      if (skipped > 0) report.skipped[handler.type] = skipped;
    }

    this.logger.log(report, '回收桶到期清除完成');
    return report;
  }

  private async purgeBatch(
    handler: TrashHandler,
    batch: readonly ExpiredTrashItem[],
    retentionDays: number,
    tx: Transaction,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const item of batch) {
      // oxlint-disable-next-line no-await-in-loop -- 同一個交易內依序；每一列一個 savepoint
      if (await this.purgeOne(handler, item, retentionDays, tx)) ids.push(item.id);
    }
    return ids;
  }

  private async purgeOne(
    handler: TrashHandler,
    item: ExpiredTrashItem,
    retentionDays: number,
    tx: Transaction,
  ): Promise<boolean> {
    try {
      return await tx.transaction(async (savepoint) => {
        if (!(await handler.purge(item, savepoint))) return false;
        await this.audit.record(
          {
            action: `${handler.type}.purge`,
            resourceType: handler.type,
            resourceId: item.id,
            resourceName: item.name,
            actorId: null,
            actorEmail: 'system',
            metadata: { retentionDays, deletedAt: item.deletedAt.toISOString() },
          },
          savepoint,
        );
        return true;
      });
    } catch (error) {
      // 仍被 RESTRICT 的外鍵參照（例：還擁有資料夾的使用者）：這一輪略過，等參照它的列先被清掉
      if (!isForeignKeyViolation(error)) throw error;
      this.logger.warn({ type: handler.type, id: item.id }, '仍被其他資料參照，這一輪略過永久刪除');
      return false;
    }
  }

  /**
   * 租戶停用了這一類所屬的 feature → `404 FEATURE_DISABLED`（docs/architecture/frontend/02-plugin-system.md §9.2 D11）。`GET /trash` 本身是常駐的端點，
   * 無法以 `@RequireFeature` 標在路由上，所以依類型在這裡判斷。沒有租戶脈絡時不判斷（與 `FeatureGuard` 相同）。
   */
  private assertFeatureEnabled(handler: TrashHandler): void {
    const tenant = currentTenant();
    if (handler.feature && tenant && !tenant.features.includes(handler.feature)) {
      throw new AppException('FEATURE_DISABLED');
    }
  }

  /** 看某一類的回收桶＝能刪除那一類（docs/architecture/backend/14-revisions.md §9.2 D10）；路由只擋了「任一種都不能刪」的人。 */
  private async assertCanView(handler: TrashHandler, actor: AuthUser): Promise<void> {
    const { permissions, isSuperAdmin } = await this.permissionService.getPermissionSet(actor.id);
    if (isSuperAdmin || permissions.has(handler.permission)) return;
    const required = [handler.permission];
    // 與 PermissionsGuard 相同的拒絕紀錄：稽核看得到誰試著看哪一類
    await this.audit.recordSafely({
      action: 'authz.denied',
      result: 'failure',
      actorId: actor.id,
      actorEmail: actor.email,
      resourceType: 'authz',
      errorCode: 'AUTHZ_FORBIDDEN',
      metadata: { route: 'GET /trash', type: handler.type, required, missing: required },
    });
    throw new AppException('AUTHZ_FORBIDDEN', { required, missing: required });
  }
}
