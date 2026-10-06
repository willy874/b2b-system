import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { SecretBox, TENANT_SECRET_PURPOSE } from '@/core/crypto';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { defineJob, JobQueue } from '@/core/jobs';
import { ObjectStorage } from '@/core/storage';
import { Tenancy, TenantDirectory } from '@/core/tenant';
import { seedPermissions, seedRoles, seedTenantAdmin } from '@/db/bootstrap';
import { createScriptClient } from '@/db/connect';
import type { TenantRow } from '@/db/platform/schema';
import { ensureTenantDatabase, migrateTenantDatabase } from '@/db/provision';
import { ACTIVATION_MAIL_JOB } from '@/modules/credential/auth-mail.constants';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';
import {
  PlatformNotificationRoute,
  PlatformNotificationType,
} from '@/modules/platform-notification/platform-notification.constants';
import { PlatformNotificationService } from '@/modules/platform-notification/platform-notification.service';

import { PlatformTenantRepository } from './platform-tenant.repository';

/**
 * 佈建一個租戶（docs/architecture/05-tenancy.md §10.2 D12）。平台工作：handler 裡沒有租戶脈絡，
 * 自己連到新租戶的 DB。不自動重試——失敗停在 `failed`，平台管理者看過原因後手動重試（每一步都冪等）。
 */
export const TENANT_PROVISION_JOB = defineJob<{ tenantId: string }>('tenant.provision', {
  scope: 'platform',
  retryLimit: 0,
  expireInSeconds: 15 * 60,
});

/**
 * 佈建中斷的補救：程序在佈建途中被重啟時，工作被 pg-boss 在 `expireInSeconds` 後收回，
 * 租戶卻還停在 `provisioning`。排程把這種租戶改成 `failed`，平台管理者就能重試或刪除。
 */
export const TENANT_PROVISION_SWEEP_JOB = defineJob<Record<string, never>>(
  'tenant.provisionSweep',
  { scope: 'platform', exclusive: true, retryLimit: 0, expireInSeconds: 60 },
);
const PROVISION_SWEEP_CRON = '*/5 * * * *';

/** 超過佈建工作的逾時再多 5 分鐘仍在 `provisioning`，視為中斷。 */
export const PROVISION_STALE_MS = (TENANT_PROVISION_JOB.options.expireInSeconds + 5 * 60) * 1000;
const INTERRUPTED_REASON = '佈建中斷（程序在佈建途中停止），請重試';

/** 佈建失敗的原因最多存多長（給平台管理者看，不是完整的堆疊）。 */
const MAX_ERROR_LENGTH = 500;

@Injectable()
export class TenantProvisioner implements OnModuleInit {
  private readonly logger = new Logger(TenantProvisioner.name);
  private readonly secrets: SecretBox;
  private readonly adminUrl: string;

  constructor(
    private readonly repo: PlatformTenantRepository,
    private readonly jobs: JobQueue,
    private readonly tenancy: Tenancy,
    private readonly directory: TenantDirectory,
    private readonly storage: ObjectStorage,
    private readonly audit: PlatformAuditService,
    private readonly events: DomainEventBus,
    private readonly notifications: PlatformNotificationService,
    config: ConfigService<Env, true>,
  ) {
    this.secrets = SecretBox.fromConfig(
      config.get('TENANT_SECRET_KEY', { infer: true }),
      config.get('JWT_SECRET', { infer: true }),
      TENANT_SECRET_PURPOSE,
    );
    this.adminUrl =
      config.get('TENANT_PROVISIONING_DATABASE_URL', { infer: true }) ??
      config.get('PLATFORM_DATABASE_URL', { infer: true });
  }

  onModuleInit(): void {
    this.jobs.register(TENANT_PROVISION_JOB, ({ tenantId }) => this.provision(tenantId));
    this.jobs.register(
      TENANT_PROVISION_SWEEP_JOB,
      async () => ({ interrupted: await this.failStaleProvisioning() }),
      { cron: PROVISION_SWEEP_CRON },
    );
  }

  /** 逾時仍在 `provisioning` 的租戶改成 `failed`（條件式更新，多個程序同時跑也安全）；回傳改了幾個。 */
  async failStaleProvisioning(now = new Date()): Promise<number> {
    const stale = await this.repo.failStaleProvisioning(
      new Date(now.getTime() - PROVISION_STALE_MS),
      INTERRUPTED_REASON,
    );
    if (!stale.length) return 0;
    this.directory.invalidate();
    for (const tenant of stale) {
      this.logger.warn({ tenant: tenant.code }, '佈建中斷，改成 failed');
      // oxlint-disable-next-line no-await-in-loop -- 數量很少
      await this.audit.recordSafely({
        action: 'tenant.provision',
        resourceType: 'tenant',
        resourceId: tenant.id,
        actorEmail: 'system',
        result: 'failure',
        errorCode: 'TENANT_PROVISION_INTERRUPTED',
        metadata: { code: tenant.code, reason: INTERRUPTED_REASON },
      });
    }
    return stale.length;
  }

  /** 新租戶的連線字串：與佈建用的連線同一台伺服器，角色、密碼、database 都是這個租戶自己的。 */
  tenantDatabaseUrl(name: string, password: string): string {
    const url = new URL(this.adminUrl);
    url.username = name;
    url.password = password;
    url.pathname = `/${name}`;
    return url.toString();
  }

  async provision(tenantId: string): Promise<object> {
    const tenant = await this.repo.findById(tenantId);
    // 重複入列、或在排隊期間被刪除：只處理「佈建中」的租戶
    if (!tenant || tenant.status !== 'provisioning') {
      return { skipped: tenant?.status ?? 'missing' };
    }

    let admin: { id: string; status: string } | undefined;
    try {
      const url = this.secrets.decrypt(tenant.databaseUrlEncrypted);
      await ensureTenantDatabase(this.adminUrl, url);
      await migrateTenantDatabase(url);
      admin = await this.seed(url, tenant);
      const activated = await this.repo.update(
        tenant.id,
        { status: 'active', provisionError: null, provisionedAt: new Date() },
        ['provisioning'],
      );
      // 佈建期間被刪除了：不再往下做
      if (!activated) return { skipped: 'changed' };
      this.directory.invalidate();
    } catch (error) {
      return this.fail(tenant, error);
    }

    // 租戶已經可以使用；下面兩步各自獨立，失敗不改狀態，記下原因給平台管理者看。
    // 啟用信先寄：bucket 連不上（儲存服務暫時故障）不該讓第一位管理員進不來，bucket 在第一次上傳前還會再確認一次
    const followUp = await this.tenancy
      .run(tenant.id, async () => {
        const failures: string[] = [];
        const attempt = async (step: string, fn: () => Promise<unknown>) => {
          try {
            await fn();
          } catch (error) {
            this.logger.error(
              { err: error, tenant: tenant.code, step },
              '租戶已佈建，但後續步驟失敗',
            );
            failures.push(`${step}: ${this.describe(error)}`);
          }
        };
        if (admin?.status === 'pending') {
          await attempt('activationMail', () =>
            this.jobs.enqueue(ACTIVATION_MAIL_JOB, { userId: admin.id }),
          );
        }
        await attempt('storageBucket', () => this.storage.ensureBucket());
        // 每個租戶一份的初始資料（檔案的系統資料夾…）由擁有它的模組訂閱處理
        this.events.publish(DomainEvent.TENANT_ACTIVATED, {});
        return failures.length ? failures.join('; ').slice(0, MAX_ERROR_LENGTH) : undefined;
      })
      .catch((error: unknown) => this.describe(error));
    if (followUp) await this.repo.update(tenant.id, { provisionError: followUp });

    await this.audit.recordSafely({
      action: 'tenant.provision',
      resourceType: 'tenant',
      resourceId: tenant.id,
      actorEmail: 'system',
      metadata: {
        code: tenant.code,
        followUpError: followUp,
      },
    });
    await this.announce(tenant, PlatformNotificationType.TENANT_PROVISIONED, {});
    return { code: tenant.code, adminId: admin?.id ?? null };
  }

  /** 權限目錄、系統角色、第一位管理員（沒有指定管理員時略過）。 */
  private async seed(
    url: string,
    tenant: TenantRow,
  ): Promise<{ id: string; status: string } | undefined> {
    const { client, db } = createScriptClient(url);
    try {
      const catalog = await seedPermissions(db);
      const roles = await seedRoles(db);
      this.logger.log(
        { tenant: tenant.code, permissions: catalog.count, createdRoles: roles.created },
        '租戶的權限目錄與系統角色已就緒',
      );
      if (!tenant.adminEmail) return undefined;
      return await seedTenantAdmin(db, {
        email: tenant.adminEmail,
        displayName: tenant.adminName ?? tenant.adminEmail.split('@')[0] ?? tenant.adminEmail,
      });
    } finally {
      await client.end();
    }
  }

  private async fail(tenant: TenantRow, error: unknown): Promise<object> {
    const reason = this.describe(error);
    this.logger.error({ err: error, tenant: tenant.code }, '租戶佈建失敗');
    await this.repo.update(tenant.id, { status: 'failed', provisionError: reason }, [
      'provisioning',
    ]);
    await this.audit.recordSafely({
      action: 'tenant.provision',
      resourceType: 'tenant',
      resourceId: tenant.id,
      actorEmail: 'system',
      result: 'failure',
      errorCode: 'TENANT_PROVISION_FAILED',
      metadata: { code: tenant.code, reason },
    });
    await this.announce(tenant, PlatformNotificationType.TENANT_PROVISION_FAILED, { reason });
    return { failed: reason };
  }

  /**
   * 佈建的結果：推給平台管理者的畫面（docs/architecture/backend/08-realtime.md §3.6），並通知能建立租戶的人
   * （docs/architecture/backend/15-notification.md §6.2）。佈建在背景工作裡跑，建立的人多半已經離開那一頁。
   */
  private async announce(
    tenant: TenantRow,
    type: PlatformNotificationType,
    params: Record<string, unknown>,
  ): Promise<void> {
    this.events.publish(DomainEvent.PLATFORM_CHANGED, {
      changes: [{ resource: ChangeSource.PLATFORM_TENANT, kind: ChangeKind.UPDATE, id: tenant.id }],
    });
    await this.notifications.notifyHolders('tenant:create', {
      type,
      params: { code: tenant.code, name: tenant.name, ...params },
      link: { route: PlatformNotificationRoute.TENANT_DETAIL, params: { id: tenant.id } },
    });
  }

  private describe(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, MAX_ERROR_LENGTH);
  }
}
