import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { AuditResourceType, TenantFeature } from '@/shared/api-sdk';

import { useAuditLogFilters } from '../useAuditLogFilters';

function resourceOptions(): string[] {
  const { result } = renderHook(() =>
    useAuditLogFilters({ search: { offset: 0, limit: 50 }, setFilter: vi.fn(), setPage: vi.fn() }),
  );
  const field = result.current.fields.find((item) => item.key === 'resourceType');
  return field?.type === 'select' ? field.options.map((option) => option.value) : [];
}

function setReady(...ids: string[]) {
  featureStore.setState({
    resolved: true,
    statuses: new Map(ids.map((id) => [id, 'ready'] as const)),
  });
}

describe('useAuditLogFilters 的資源選項（docs/architecture/frontend/02-plugin-system.md §7）', () => {
  beforeEach(() => {
    resetFeatureStore();
  });

  it('feature 都啟用 → 列出後端所有稽核的資源類型（docs/architecture/backend/06-audit-log.md §7）', () => {
    setReady(...Object.values(TenantFeature));
    expect(resourceOptions().toSorted()).toEqual(Object.values(AuditResourceType).toSorted());
  });

  it('平台沒有啟用的 feature 的資源不列出（服務帳號與 API token 屬於對外 API）', () => {
    setReady('auditLog');
    expect(resourceOptions()).toEqual([
      'user',
      'role',
      'auth',
      'authz',
      'mfaPolicy',
      'approval',
      'approvalFlow',
      'tag',
      'comment',
      'notificationPolicy',
      'auditLog',
    ]);
  });
});
