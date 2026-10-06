import { vi } from 'vitest';

import type { PermissionKey } from '@/common/types';
import type { AuthzRevision, AuthzService } from '@/core/authz';
import type { PermissionCacheService, PermissionSet } from '@/core/cache';
import type { AuditService } from '@/modules/audit-log/audit.service';

import type { PermissionRepository } from '../permission.repository';
import { PermissionService } from '../permission.service';

/** 操作者的權限集合（測試中可以換）。 */
export interface FakePermissionSet {
  permissions: ReadonlySet<PermissionKey> | ReadonlySet<string>;
  isSuperAdmin: boolean;
}

/**
 * 給其他模組的單元測試用：一個真的 `PermissionService`，`getPermissionSet` 換成回傳 `set()` 的 spy，
 * `assertHasAll`／`assertHasAny` 走真的判斷，拒絕時寫進 `audit.recordSafely`。呼叫端的測試因此能直接斷言
 * `authz.denied` 的稽核與 `AUTHZ_FORBIDDEN` 的 `details`（docs/architecture/backend/05-rbac.md §3.1），不必各自重寫一份假的判斷。
 * `audit` 可以傳入呼叫端自己的假物件（與受測 service 共用同一個，斷言不必分兩處）。
 */
export function createPermissionChecks<
  Audit extends { recordSafely: unknown } = { recordSafely: ReturnType<typeof vi.fn> },
>(set: () => FakePermissionSet, audit?: Audit) {
  const recorder = audit ?? { recordSafely: vi.fn(async () => undefined) };
  const service = new PermissionService(
    {} as PermissionRepository,
    {} as PermissionCacheService,
    {} as AuthzService,
    {} as AuthzRevision,
    recorder as unknown as AuditService,
  );
  const getPermissionSet = vi
    .spyOn(service, 'getPermissionSet')
    .mockImplementation(async () => set() as PermissionSet);
  return { service, audit: recorder as Audit, getPermissionSet };
}
