import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { FeatureFlagService } from '@/core/feature-flags';
import type { FeatureFlagGlobalState } from '@/core/feature-flags';
import { TenantDirectory } from '@/core/tenant';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type {
  FeatureFlagDto,
  FeatureFlagListDto,
  UpdateFeatureFlagDto,
} from './dto/feature-flag.dto';
import { PlatformFeatureFlagRepository } from './platform-feature-flag.repository';

/**
 * 平台管理者的 feature flag 管理（apps/platform，docs/architecture/05-tenancy.md §11.2 D7、D8）：目錄與全平台層的覆寫。
 * 租戶層的覆寫在租戶詳情（`PATCH /platform/tenants/:id` 的 `flags`）。
 */
@Injectable()
export class PlatformFeatureFlagService {
  private readonly logger = new Logger(PlatformFeatureFlagService.name);

  constructor(
    private readonly repo: PlatformFeatureFlagRepository,
    private readonly flags: FeatureFlagService,
    private readonly directory: TenantDirectory,
    private readonly events: DomainEventBus,
    private readonly audit: PlatformAuditService,
  ) {}

  async list(): Promise<FeatureFlagListDto> {
    // 全平台層以 DB 為準（不讀快取）：別的執行個體剛改過，這裡也要看得到
    await this.flags.reload();
    const counts = await this.repo.countTenantOverrides();
    return {
      items: this.flags.catalog.map((flag) => {
        const countOf = (enabled: boolean) =>
          counts.find((row) => row.key === flag.key && row.enabled === enabled)?.count ?? 0;
        return {
          key: flag.key,
          description: flag.description,
          defaultEnabled: flag.defaultEnabled,
          owner: flag.owner,
          removeBy: flag.removeBy,
          globalState: this.flags.globalStateOf(flag.key) ?? null,
          tenantOverrides: { on: countOf(true), off: countOf(false) },
        };
      }),
    };
  }

  async update(key: string, dto: UpdateFeatureFlagDto, actor: AuthUser): Promise<FeatureFlagDto> {
    if (!this.flags.has(key)) throw new AppException('FEATURE_FLAG_NOT_FOUND');
    const after: FeatureFlagGlobalState | undefined =
      dto.state === 'default' ? undefined : dto.state;
    const changed = await this.repo.transaction(async (tx) => {
      const before = await this.repo.findGlobalForUpdate(key, tx);
      if (before === after) return false;
      if (after) await this.repo.setGlobal(key, after, actor.id, tx);
      else await this.repo.clearGlobal(key, tx);
      await this.audit.record(
        {
          action: 'featureFlag.update',
          resourceType: 'featureFlag',
          resourceId: null,
          metadata: { key, before: before ?? 'default', after: after ?? 'default' },
        },
        tx,
      );
      return true;
    });

    if (changed) {
      // 失效之後才通知：前端收到後重新取得的 profile 已經是新的值（D7）；其他程序經廣播重新讀取
      await this.flags.changed();
      await this.notifyAllTenants();
      // 平台管理者的畫面（docs/architecture/backend/08-realtime.md §3.6）
      this.events.publish(DomainEvent.PLATFORM_CHANGED, {
        changes: [
          { resource: ChangeSource.PLATFORM_FEATURE_FLAG, kind: ChangeKind.UPDATE, id: key },
        ],
      });
    }
    const flag = (await this.list()).items.find((item) => item.key === key);
    if (!flag) throw new AppException('FEATURE_FLAG_NOT_FOUND');
    return flag;
  }

  /**
   * 全平台層影響所有租戶：對每個 `active` 租戶發佈與 feature 變更相同的事件，前端重新取得 profile。
   * 停用中的租戶沒有連線，重新啟用時本來就會重新載入。
   */
  private async notifyAllTenants(): Promise<void> {
    try {
      for (const tenant of await this.directory.listActive()) {
        this.events.publish(DomainEvent.TENANT_FEATURES_CHANGED, { tenantId: tenant.id });
      }
    } catch (error) {
      // 變更已經生效；推播失敗只是前端晚一點（下次取得 profile）才看到
      this.logger.error({ err: error }, '推播 feature flag 的變更失敗');
    }
  }
}
