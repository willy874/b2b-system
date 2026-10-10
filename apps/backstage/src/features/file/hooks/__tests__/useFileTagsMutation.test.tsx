import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { useFileTagsMutation } from '../useFileTagsMutation';

const api = vi.hoisted(() => ({
  replaceTags: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/tag/replace-resource-tags/fetcher', () => ({
  fetchResourceTagsReplaceMutation: api.replaceTags,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFileTagsMutation（docs/architecture/backend/18-tag.md §7.2 D7）', () => {
  it('檔案 → 整批取代標籤，以 file update 宣告並提示', async () => {
    api.replaceTags.mockResolvedValue({ tags: [] });
    const result = render(() => useFileTagsMutation());
    const variables = {
      params: { resourceType: 'file' as const, resourceId: 'f1', tagIds: ['t1', 't2'] },
    };
    act(() => result.current.mutate(variables));

    expect(await screen.findByText('已更新標籤')).toBeInTheDocument();
    expect(api.replaceTags.mock.calls[0]![0]).toEqual(variables);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'file', kind: 'update', id: 'f1' },
    ]);
  });

  it('資料夾 → 以 fileFolder update 宣告', async () => {
    api.replaceTags.mockResolvedValue({ tags: [] });
    const result = render(() => useFileTagsMutation());
    act(() =>
      result.current.mutate({
        params: { resourceType: 'fileFolder', resourceId: 'd1', tagIds: [] },
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'fileFolder', kind: 'update', id: 'd1' },
    ]);
  });

  it('失敗 → 錯誤交給對話框：不失效、不彈 toast', async () => {
    api.replaceTags.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useFileTagsMutation());
    act(() =>
      result.current.mutate({ params: { resourceType: 'file', resourceId: 'f1', tagIds: [] } }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText('你沒有執行這個操作的權限。')).not.toBeInTheDocument();
  });
});
