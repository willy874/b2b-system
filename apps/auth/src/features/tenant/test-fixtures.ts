import type { PlatformTenant } from '@/shared/api-sdk';

/** 頁面測試共用的租戶。 */
export function tenantFixture(overrides: Partial<PlatformTenant> = {}): PlatformTenant {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    code: 'acme',
    name: 'Acme 股份有限公司',
    status: 'active',
    domains: ['acme.localhost:5173', 'portal.acme.test'],
    storageBucket: 'b2b-acme',
    allowExternalIdp: true,
    adminEmail: 'owner@acme.test',
    provisionError: null,
    provisionedAt: '2026-09-30T00:00:00.000Z',
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}
