import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BroadcastService } from '@/core/broadcast';
import type { BroadcastPublisher } from '@/core/broadcast';
import type { Env } from '@/core/config';
import { FEATURE_FLAG_GLOBAL_STATES, resolveToggle } from '@/core/feature-flags';
import type { FeatureFlagGlobalState } from '@/core/feature-flags';
import type { MfaMethod } from '@/core/mfa';
import { currentTenant } from '@/core/tenant';

import { MfaMethodOverrideRepository } from './mfa-method-override.repository';

/** 全平台層開關變更時通知其他程序重新讀取（D4；不重蹈 feature flag 只靠 TTL 的覆轍）。 */
export const MFA_METHOD_OVERRIDE_CHANNEL = 'mfa_method_overrides';

/**
 * MFA 方式的平台層開關（docs/architecture/backend/21-mfa.md §5、D4）：全平台層快取在這裡（變更時廣播、另有 TTL 兜底），
 * 租戶層在 `TenantContext.mfaMethods`。生效值與 feature flag 同一個規則（`resolveToggle`）。
 */
@Injectable()
export class MfaMethodOverrideService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MfaMethodOverrideService.name);
  private readonly ttlMs: number;
  private global = new Map<string, FeatureFlagGlobalState>();
  private refreshTimer?: NodeJS.Timeout;
  private publish?: BroadcastPublisher<Record<string, never>>;

  constructor(
    private readonly repo: MfaMethodOverrideRepository,
    private readonly broadcast: BroadcastService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('TENANT_CACHE_TTL', { infer: true }) * 1000;
  }

  onModuleInit(): void {
    this.publish = this.broadcast.channel(MFA_METHOD_OVERRIDE_CHANNEL, {
      parse: (value) => (typeof value === 'object' && value !== null ? {} : null),
      onMessage: () => this.reload(),
      onReconnect: () => this.reload(),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.reload();
    if (this.ttlMs > 0) {
      this.refreshTimer = setInterval(() => void this.reload(), this.ttlMs);
      this.refreshTimer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.refreshTimer);
  }

  globalStateOf(methodId: string): FeatureFlagGlobalState | undefined {
    return this.global.get(methodId);
  }

  /** 平台層的生效值；在租戶脈絡裡算上租戶層的覆寫。 */
  isEnabled(method: MfaMethod, tenantOverrides = currentTenant()?.mfaMethods): boolean {
    const id = method.definition.id;
    return resolveToggle(
      method.definition.defaultEnabled,
      this.global.get(id),
      tenantOverrides?.[id],
    );
  }

  /** 改了全平台層之後：本機立即重讀，再通知其他程序。 */
  async changed(): Promise<void> {
    await this.reload();
    await this.publish?.({});
  }

  /** 讀取失敗時沿用上一份。 */
  async reload(): Promise<void> {
    try {
      const rows = await this.repo.listGlobal();
      this.global = new Map(
        rows
          .filter((row) => (FEATURE_FLAG_GLOBAL_STATES as readonly string[]).includes(row.state))
          .map((row) => [row.method, row.state]),
      );
    } catch (error) {
      this.logger.error({ err: error }, '載入 MFA 方式的全平台開關失敗');
    }
  }
}
