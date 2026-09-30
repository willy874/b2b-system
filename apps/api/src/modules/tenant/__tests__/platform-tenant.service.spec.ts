import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import type { Tenancy, TenantDirectory } from '@/core/tenant';
import type { AuthService } from '@/modules/auth/auth.service';
import type { OidcProviderService } from '@/modules/oidc-provider/oidc-provider.service';
import type { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type { PlatformTenantRepository, TenantWithDomains } from '../platform-tenant.repository';
import { PlatformTenantService } from '../platform-tenant.service';
import type { TenantProvisioner } from '../tenant-provisioner';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';

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
    allowExternalIdp: true,
    features: ['file', 'auditLog', 'job'],
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    domains: ['acme.example.test'],
    ...overrides,
  };
}

/** 依呼叫順序記下副作用，驗證「交易 → 失效 → 發佈」的先後（CLAUDE.md 後端規則 6）。 */
function setup(initial: TenantWithDomains = tenantRow()) {
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
        AUTH_APP_URL: 'http://localhost:5175',
      })[key as string],
  } as unknown as ConfigService<Env, true>;

  const service = new PlatformTenantService(
    repo as unknown as PlatformTenantRepository,
    {} as TenantProvisioner,
    {} as JobQueue,
    {} as Tenancy,
    directory as unknown as TenantDirectory,
    {} as AuthService,
    {} as OidcProviderService,
    events as unknown as DomainEventBus,
    audit as unknown as PlatformAuditService,
    config,
  );
  return { service, repo, audit, directory, events, calls };
}

describe('PlatformTenantService.update 的 features（docs/adr/0021-runtime-feature-activation.md D8）', () => {
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
    expect(calls).toEqual(['transaction', 'audit', 'invalidate', 'publish']);
    expect(result.features).toEqual(['auditLog', 'job']);
  });

  it('清單沒有變（只是順序不同）→ 不發佈事件', async () => {
    const { service, events, directory } = setup();

    await service.update(TENANT_ID, { features: ['job', 'file', 'auditLog'] });

    expect(directory.invalidate).toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
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
    expect(events.publish).not.toHaveBeenCalled();
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
