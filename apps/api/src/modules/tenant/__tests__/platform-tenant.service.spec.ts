import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { FeatureFlagDefinition, FeatureFlagService } from '@/core/feature-flags';
import type { JobQueue } from '@/core/jobs';
import { MfaMethodRegistry } from '@/core/mfa';
import { TenantFeatureImpacts } from '@/core/tenant';
import type { Tenancy, TenantDirectory } from '@/core/tenant';
import type { RefreshTokenService } from '@/modules/credential/refresh-token.service';
import type { OidcProviderService } from '@/modules/oidc-provider/oidc-provider.service';
import type { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type { PlatformTenantRepository, TenantWithDomains } from '../platform-tenant.repository';
import { PlatformTenantService } from '../platform-tenant.service';
import type { TenantProvisioner } from '../tenant-provisioner';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';

const FLAG_CATALOG: FeatureFlagDefinition[] = [
  {
    key: 'levelEditor.v2',
    description: '',
    defaultEnabled: false,
    owner: 't',
    removeBy: '2099-01-01',
  },
  {
    key: 'user.bulkInvite',
    description: '',
    defaultEnabled: false,
    owner: 't',
    removeBy: '2099-01-01',
  },
];
const flagService = {
  catalog: FLAG_CATALOG,
  has: (key: string) => FLAG_CATALOG.some((flag) => flag.key === key),
} as unknown as FeatureFlagService;

function tenantRow(overrides: Partial<TenantWithDomains> = {}): TenantWithDomains {
  const at = new Date('2026-09-30T00:00:00Z');
  return {
    id: TENANT_ID,
    code: 'acme',
    name: 'Acme',
    status: 'active',
    databaseUrlEncrypted: 'x',
    storageBucket: 'b2b-acme',
    adminEmail: null,
    adminName: null,
    provisionError: null,
    provisionedAt: at,
    features: ['file', 'auditLog', 'job'],
    flags: {},
    featureParams: {},
    mfaMethods: {},
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    domains: ['acme.example.test'],
    ...overrides,
  };
}

/** 依呼叫順序記下副作用，驗證「交易 → 失效 → 發佈」的先後（CLAUDE.md 後端規則 6）。 */
function setup(
  initial: TenantWithDomains = tenantRow(),
  options: { tenancy?: Partial<Tenancy>; impacts?: TenantFeatureImpacts } = {},
) {
  const calls: string[] = [];
  let current = initial;
  const repo = {
    findById: vi.fn(async () => current),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      calls.push('transaction');
      return fn('tx');
    }),
    update: vi.fn(async (_id: string, patch: Partial<TenantWithDomains>) => {
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      current = { ...current, ...defined };
      return current;
    }),
  };
  const audit = {
    record: vi.fn(async () => {
      calls.push('audit');
    }),
  };
  const directory = { invalidate: vi.fn(() => calls.push('invalidate')) };
  const events = { publish: vi.fn(() => calls.push('publish')) };
  const config = {
    get: (key: keyof Env) =>
      ({
        TENANT_SECRET_KEY: undefined,
        JWT_SECRET: 'test-secret-that-is-long-enough-32ch',
        TENANT_BASE_DOMAIN: 'example.test',
        APP_PUBLIC_URL: 'http://localhost:5173',
        PLATFORM_APP_URL: 'http://localhost:5175',
      })[key as string],
  } as unknown as ConfigService<Env, true>;

  const provisioner = { tenantDatabaseUrl: vi.fn(() => 'postgres://tenant') };

  const service = new PlatformTenantService(
    repo as unknown as PlatformTenantRepository,
    provisioner as unknown as TenantProvisioner,
    {} as JobQueue,
    (options.tenancy ?? {}) as Tenancy,
    directory as unknown as TenantDirectory,
    {} as RefreshTokenService,
    {} as OidcProviderService,
    events as unknown as DomainEventBus,
    audit as unknown as PlatformAuditService,
    flagService,
    options.impacts ?? new TenantFeatureImpacts(),
    new MfaMethodRegistry(),
    config,
  );
  return { service, repo, audit, directory, events, calls };
}

describe('PlatformTenantService.featureImpact（關閉 feature 前的確認框）', () => {
  it('進入那個租戶以登記的計數計算，依固定順序列出有值的項目', async () => {
    const impacts = new TenantFeatureImpacts();
    impacts.register('identityProvider', async () => ({
      passwordlessExternalUsers: 3,
      identityProviderConnections: 1,
    }));
    const runForMaintenance = vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn());
    const { service } = setup(tenantRow(), {
      impacts,
      tenancy: { runForMaintenance } as unknown as Partial<Tenancy>,
    });

    await expect(service.featureImpact(TENANT_ID, 'identityProvider')).resolves.toEqual({
      feature: 'identityProvider',
      available: true,
      items: [
        { key: 'identityProviderConnections', count: 1 },
        { key: 'passwordlessExternalUsers', count: 3 },
      ],
    });
    expect(runForMaintenance).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
  });

  it('沒有登記計數的 feature → 空清單，不進入租戶', async () => {
    const runForMaintenance = vi.fn();
    const { service } = setup(tenantRow(), {
      tenancy: { runForMaintenance } as unknown as Partial<Tenancy>,
    });
    await expect(service.featureImpact(TENANT_ID, 'webhook')).resolves.toEqual({
      feature: 'webhook',
      available: true,
      items: [],
    });
    expect(runForMaintenance).not.toHaveBeenCalled();
  });

  it('進不了租戶的 DB（TENANT_UNAVAILABLE）→ available: false', async () => {
    const impacts = new TenantFeatureImpacts();
    impacts.register('identityProvider', async () => ({}));
    const { service } = setup(tenantRow(), {
      impacts,
      tenancy: {
        runForMaintenance: vi.fn(async () => {
          throw new AppException('TENANT_UNAVAILABLE', { reason: 'maintenance' });
        }),
      } as unknown as Partial<Tenancy>,
    });
    await expect(service.featureImpact(TENANT_ID, 'identityProvider')).resolves.toEqual({
      feature: 'identityProvider',
      available: false,
      items: [],
    });
  });
});

describe('PlatformTenantService.update 的 features（docs/architecture/frontend/02-plugin-system.md §9.2 D8）', () => {
  it('關掉 file：寫入完整清單、稽核帶 before/after，失效後發佈 tenant.featuresChanged', async () => {
    const { service, repo, audit, events, calls } = setup();

    const result = await service.update(TENANT_ID, { features: ['job', 'auditLog'] });

    // 依 TENANT_FEATURES 的順序存，不受送出順序影響
    expect(repo.update).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ features: ['auditLog', 'job'] }),
      undefined,
      'tx',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.update',
        metadata: expect.objectContaining({
          before: expect.objectContaining({ features: ['file', 'auditLog', 'job'] }),
          after: expect.objectContaining({ features: ['auditLog', 'job'] }),
        }),
      }),
      'tx',
    );
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.TENANT_FEATURES_CHANGED, {
      tenantId: TENANT_ID,
    });
    // 先通知租戶的連線，再推給平台管理者的畫面（platform.changed）
    expect(calls).toEqual(['transaction', 'audit', 'invalidate', 'publish', 'publish']);
    expect(result.features).toEqual(['auditLog', 'job']);
  });

  it('清單沒有變（只是順序不同）→ 不發佈事件', async () => {
    const { service, events, directory } = setup();

    await service.update(TENANT_ID, { features: ['job', 'file', 'auditLog'] });

    expect(directory.invalidate).toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalledWith(
      DomainEvent.TENANT_FEATURES_CHANGED,
      expect.anything(),
    );
  });

  it('只改名稱 → features 不動、稽核的 after 沿用原本的清單、不發佈事件', async () => {
    const { service, repo, audit, events } = setup(tenantRow({ features: ['file'] }));

    await service.update(TENANT_ID, { name: 'Acme 2' });

    expect(repo.update).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ name: 'Acme 2', features: undefined }),
      undefined,
      'tx',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          after: expect.objectContaining({ features: ['file'] }),
        }),
      }),
      'tx',
    );
    expect(events.publish).not.toHaveBeenCalledWith(
      DomainEvent.TENANT_FEATURES_CHANGED,
      expect.anything(),
    );
  });

  it('DB 裡不認得的 id 不出現在回應', async () => {
    const { service } = setup(tenantRow({ features: ['file', 'removed-feature'] }));

    expect((await service.get(TENANT_ID)).features).toEqual(['file']);
  });

  it('租戶不存在 → TENANT_NOT_FOUND，不寫入也不發佈', async () => {
    const { service, repo, events } = setup();
    repo.findById.mockResolvedValueOnce(undefined as never);

    await expect(service.update(TENANT_ID, { features: [] })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
    expect(repo.transaction).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });
});

describe('PlatformTenantService.update 的 flags（docs/architecture/05-tenancy.md §11.2 D7）', () => {
  it('寫入完整的覆寫表（依目錄的順序）、稽核帶 before/after，失效後發佈 tenant.featuresChanged', async () => {
    const { service, repo, audit, events, calls } = setup(
      tenantRow({ flags: { 'levelEditor.v2': false } }),
    );

    const result = await service.update(TENANT_ID, {
      flags: { 'user.bulkInvite': false, 'levelEditor.v2': true },
    });

    expect(repo.update).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ flags: { 'levelEditor.v2': true, 'user.bulkInvite': false } }),
      undefined,
      'tx',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          before: expect.objectContaining({ flags: { 'levelEditor.v2': false } }),
          after: expect.objectContaining({
            flags: { 'levelEditor.v2': true, 'user.bulkInvite': false },
          }),
        }),
      }),
      'tx',
    );
    // 先通知租戶的連線，再推給平台管理者的畫面（platform.changed）
    expect(calls).toEqual(['transaction', 'audit', 'invalidate', 'publish', 'publish']);
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.TENANT_FEATURES_CHANGED, {
      tenantId: TENANT_ID,
    });
    expect(result.flags).toEqual({ 'levelEditor.v2': true, 'user.bulkInvite': false });
  });

  it('覆寫表沒有變 → 不發佈事件', async () => {
    const { service, events } = setup(tenantRow({ flags: { 'levelEditor.v2': true } }));

    await service.update(TENANT_ID, { flags: { 'levelEditor.v2': true } });

    expect(events.publish).not.toHaveBeenCalledWith(
      DomainEvent.TENANT_FEATURES_CHANGED,
      expect.anything(),
    );
  });

  it('不在目錄裡的 key → VALIDATION_FAILED，不寫入', async () => {
    const { service, repo } = setup();

    await expect(
      service.update(TENANT_ID, { flags: { 'levelEditor.v2': true, 'gone.flag': true } }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: { 'flags.gone.flag': 'unknown feature flag' } },
    });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('DB 裡殘留的舊 key 不出現在回應', async () => {
    const { service } = setup(tenantRow({ flags: { 'levelEditor.v2': true, 'gone.flag': true } }));

    expect((await service.get(TENANT_ID)).flags).toEqual({ 'levelEditor.v2': true });
  });
});

describe('PlatformTenantService.update 的 featureParams（docs/architecture/05-tenancy.md §13.2 D3）', () => {
  it('只改列出的參數、null 回到預設、等於預設的不存；稽核帶 before/after，不發佈事件', async () => {
    const { service, repo, audit, events } = setup(
      tenantRow({ featureParams: { 'job.maxConcurrency': 5, 'webhook.maxUrls': 3 } }),
    );

    const result = await service.update(TENANT_ID, {
      featureParams: {
        'file.storageQuotaMb': 4096,
        'job.maxConcurrency': null,
        'auditLog.hotRetentionDays': 90,
      },
    });

    expect(repo.update).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        featureParams: { 'file.storageQuotaMb': 4096, 'webhook.maxUrls': 3 },
      }),
      undefined,
      'tx',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          before: expect.objectContaining({
            featureParams: { 'job.maxConcurrency': 5, 'webhook.maxUrls': 3 },
          }),
          after: expect.objectContaining({
            featureParams: { 'file.storageQuotaMb': 4096, 'webhook.maxUrls': 3 },
          }),
        }),
      }),
      'tx',
    );
    expect(events.publish).not.toHaveBeenCalledWith(
      DomainEvent.TENANT_FEATURES_CHANGED,
      expect.anything(),
    );
    expect(result.featureParams.find((param) => param.key === 'file.storageQuotaMb')).toEqual({
      key: 'file.storageQuotaMb',
      feature: 'file',
      type: 'integer',
      value: 4096,
      defaultValue: 2048,
      overridden: true,
      unit: 'megabytes',
      min: 1,
      max: 10_485_760,
      foreverValue: null,
      maxLength: null,
    });
    expect(result.featureParams.find((param) => param.key === 'job.maxConcurrency')).toMatchObject({
      value: 10,
      overridden: false,
    });
  });

  it('超出範圍或型別不對 → VALIDATION_FAILED（fields 指出哪一個），不寫入', async () => {
    const { service, repo } = setup();

    await expect(
      service.update(TENANT_ID, {
        featureParams: {
          'job.maxConcurrency': 0,
          'webhook.maxUrls': 'many',
          'rateLimit.trustedCidrs': '203.0.113.0/24, not-a-cidr',
        },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: {
        fields: {
          'featureParams.job.maxConcurrency': 'must be >= 1',
          'featureParams.webhook.maxUrls': 'must be an integer',
          'featureParams.rateLimit.trustedCidrs': 'invalid format',
        },
      },
    });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('DB 裡不認得或不合法的值回到預設', async () => {
    const { service } = setup(
      tenantRow({ featureParams: { 'gone.param': 1, 'job.maxConcurrency': 9999 } }),
    );

    const params = (await service.get(TENANT_ID)).featureParams;
    expect(params.map((param) => param.key)).toEqual([
      'file.storageQuotaMb',
      'auditLog.hotRetentionDays',
      'auditLog.retentionDays',
      'job.maxConcurrency',
      'identityProvider.maxProviders',
      'webhook.maxUrls',
      'dataTransfer.importMaxRows',
      'dataTransfer.importMaxSizeMb',
      'dataTransfer.exportMaxRows',
      'rateLimit.authPerMinute',
      'rateLimit.trustedCidrs',
    ]);
    expect(params.every((param) => !param.overridden)).toBe(true);
  });
});

describe('PlatformTenantService.create 的 bucket 名稱（docs/architecture/backend/03-api-conventions.md §1）', () => {
  it('由代碼推導出的 bucket 名稱不合法 → VALIDATION_FAILED（details.fields.code），不建立', async () => {
    const { service, repo } = setup();
    const create = vi.fn();
    Object.assign(repo, {
      codeTaken: vi.fn(async () => false),
      domainsTaken: vi.fn(async () => []),
      bucketsLike: vi.fn(async () => new Set<string>()),
      create,
    });

    // DTO 的代碼格式擋不到的組合（這裡直接呼叫 service，繞過 DTO）：大寫字母不能出現在 bucket 名稱
    await expect(
      service.create({ code: 'Acme', name: 'Acme', domains: [], adminEmail: 'a@example.test' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: { code: expect.any(String) } },
    });
    expect(create).not.toHaveBeenCalled();
  });
});
