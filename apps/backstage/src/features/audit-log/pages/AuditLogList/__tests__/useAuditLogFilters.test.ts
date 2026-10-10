import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';

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

  it('feature 都啟用 → 列出全部的資源', () => {
    setReady('auditLog', 'file', 'externalApi', 'webhook', 'dataTransfer');
    expect(resourceOptions()).toEqual([
      'user',
      'role',
      'approval',
      'file',
      'auth',
      'authz',
      'serviceAccount',
      'apiToken',
      'webhook',
      'tag',
      'dataTransfer',
    ]);
  });

  it('平台沒有啟用的 feature 的資源不列出（服務帳號與 API token 屬於對外 API）', () => {
    setReady('auditLog');
    expect(resourceOptions()).toEqual(['user', 'role', 'approval', 'auth', 'authz', 'tag']);
  });
});
