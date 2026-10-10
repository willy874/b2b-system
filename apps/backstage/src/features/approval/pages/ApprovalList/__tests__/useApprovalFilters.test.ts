import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';

import { useApprovalFilters } from '../useApprovalFilters';

function typeOptions(): string[] {
  const { result } = renderHook(() =>
    useApprovalFilters({
      search: { offset: 0, limit: 20, sort: [], status: 'pending' },
      setFilters: vi.fn(),
      setStatus: vi.fn(),
      setSort: vi.fn(),
      setPage: vi.fn(),
    }),
  );
  const field = result.current.fields.find((item) => item.key === 'type');
  return field?.type === 'select' ? field.options.map((option) => option.value) : [];
}

describe('useApprovalFilters 的類型選項（docs/architecture/frontend/02-plugin-system.md §7）', () => {
  beforeEach(() => {
    resetFeatureStore();
  });

  it('檔案管理已啟用 → 列出資料夾存取申請', () => {
    featureStore.setState({ resolved: true, statuses: new Map([['file', 'ready']]) });
    expect(typeOptions()).toEqual(['user.register', 'fileFolder.access']);
  });

  it('檔案管理沒有啟用 → 不列出資料夾存取申請', () => {
    featureStore.setState({ resolved: true, statuses: new Map([['file', 'disabled']]) });
    expect(typeOptions()).toEqual(['user.register']);
  });
});
