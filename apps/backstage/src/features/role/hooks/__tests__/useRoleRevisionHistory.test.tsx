import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRoleRevisionHistory } from '../useRoleRevisionHistory';

const { fetchRevisions, fetchRevision } = vi.hoisted(() => ({
  fetchRevisions: vi.fn(),
  fetchRevision: vi.fn(),
}));
vi.mock('@/apis/role/get-role-revisions/fetcher', () => ({
  fetchRoleRevisionsQuery: fetchRevisions,
}));
vi.mock('@/apis/role/get-role-revision/fetcher', () => ({ fetchRoleRevisionQuery: fetchRevision }));

const ROLE_ID = 'role-1';

const summary = (version: number) => ({
  version,
  createdAt: '2026-09-30T00:00:00.000Z',
  actor: null,
  tooLarge: false,
});
const snapshot = (version: number) => ({
  name: `v${version}`,
  description: null,
  permissionKeys: version > 1 ? ['user:read'] : [],
});

beforeEach(() => {
  fetchRevisions.mockReset().mockImplementation(({ params }: { params: { limit: number } }) =>
    Promise.resolve({
      items: [summary(3), summary(2), summary(1)].slice(0, params.limit),
      pagination: { offset: 0, limit: params.limit, total: 3 },
    }),
  );
  fetchRevision
    .mockReset()
    .mockImplementation(({ params }: { params: { version: number } }) =>
      Promise.resolve({ ...summary(params.version), snapshot: snapshot(params.version) }),
    );
});

describe('useRoleRevisionHistory（docs/architecture/frontend/14-revisions.md）', () => {
  it('預設選最新一版、與目前的內容比較：兩邊相同，isLatest', async () => {
    const { result } = renderHook(() => useRoleRevisionHistory(ROLE_ID), {
      wrapper: AllProviders,
    });
    await waitFor(() => expect(result.current.after).toBeDefined());
    expect(result.current.items.map((item) => item.version)).toEqual([3, 2, 1]);
    expect(result.current.selectedVersion).toBe(3);
    expect(result.current.isLatest).toBe(true);
    expect(result.current.before).toEqual(result.current.after);
  });

  it('選舊的一版：變更前是目前的內容（最新一版），變更後是選的那一版', async () => {
    const { result } = renderHook(() => useRoleRevisionHistory(ROLE_ID), {
      wrapper: AllProviders,
    });
    await waitFor(() => expect(result.current.latestVersion).toBe(3));
    act(() => result.current.select(1));
    await waitFor(() => expect(result.current.after).toEqual(snapshot(1)));
    expect(result.current.before).toEqual(snapshot(3));
    expect(result.current.currentSnapshot).toEqual(snapshot(3));
    expect(result.current.isLatest).toBe(false);
  });

  it('與前一版比較：變更前是版本號減一；第一版沒有前一版（isBaseMissing）', async () => {
    const { result } = renderHook(() => useRoleRevisionHistory(ROLE_ID), {
      wrapper: AllProviders,
    });
    await waitFor(() => expect(result.current.latestVersion).toBe(3));
    act(() => {
      result.current.setCompare('previous');
      result.current.select(2);
    });
    await waitFor(() => expect(result.current.before).toEqual(snapshot(1)));
    expect(result.current.after).toEqual(snapshot(2));

    act(() => result.current.select(1));
    await waitFor(() => expect(result.current.after).toEqual(snapshot(1)));
    expect(result.current.isBaseMissing).toBe(true);
    expect(result.current.before).toBeUndefined();
  });

  it('前一版已被保留清理刪除（404）→ isBaseMissing，不重試', async () => {
    fetchRevision.mockImplementation(({ params }: { params: { version: number } }) =>
      params.version === 1
        ? Promise.reject(new AppError('REVISION_NOT_FOUND', 404))
        : Promise.resolve({ ...summary(params.version), snapshot: snapshot(params.version) }),
    );
    const { result } = renderHook(() => useRoleRevisionHistory(ROLE_ID), {
      wrapper: AllProviders,
    });
    await waitFor(() => expect(result.current.latestVersion).toBe(3));
    act(() => {
      result.current.setCompare('previous');
      result.current.select(2);
    });
    await waitFor(() => expect(result.current.isBaseMissing).toBe(true));
    expect(
      fetchRevision.mock.calls.filter(([request]) => request.params.version === 1),
    ).toHaveLength(1);
  });
});
