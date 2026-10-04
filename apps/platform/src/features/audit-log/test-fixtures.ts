import type { PlatformAuditLog } from '@/shared/api-sdk';

/** 頁面與 adapter 測試共用的平台稽核紀錄。 */
export function auditLogFixture(overrides: Partial<PlatformAuditLog> = {}): PlatformAuditLog {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    occurredAt: '2026-09-30T00:00:00.000Z',
    actorId: '77777777-7777-4777-8777-777777777777',
    actorEmail: 'root@platform.test',
    action: 'tenant.create',
    resourceType: 'tenant',
    resourceId: '44444444-4444-4444-8444-444444444444',
    result: 'success',
    errorCode: null,
    metadata: { code: 'acme', domains: ['acme.localhost:5173'] },
    ...overrides,
  };
}
