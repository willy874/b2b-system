import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FILE_VIEW_PREFERENCE, useFileViewPreferenceStore } from '../../../preference';
import { useFileManagerItems } from '../useFileManagerItems';
import { useFileSelection } from '../useFileSelection';

const { fetchFolders, fetchFiles } = vi.hoisted(() => ({
  fetchFolders: vi.fn(),
  fetchFiles: vi.fn(),
}));
vi.mock('@/apis/file/get-file-folder-list/fetcher', () => ({
  fetchFileFolderListQuery: fetchFolders,
}));
vi.mock('@/apis/file/get-file-list/fetcher', () => ({ fetchFileListQuery: fetchFiles }));

const file = (id: string) => ({
  id,
  name: `${id}.txt`,
  contentType: 'text/plain',
  size: 1,
  folderId: null,
  url: null,
  downloadUrl: null,
  thumbnailUrl: null,
  image: null,
  version: 1,
  uploader: null,
  capabilities: { canUpdate: true, canDelete: true },
  tags: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

/**
 * 頁面的組合（FileManagerPage）：偏好 → 主區塊的項目 → 選取；
 * 換資料夾、換條件、換頁、換閱覽模式時清空選取（同 page.tsx 的 effect）。
 */
function useManager(keyword: string | undefined) {
  const preference = useFileViewPreferenceStore();
  const view = useFileManagerItems({
    folderId: undefined,
    keyword,
    category: undefined,
    tag: undefined,
    sort: preference.sort,
    pagingMode: preference.pagingMode,
    offset: 0,
    pageSize: preference.pageSize,
    onMissingFolder: () => undefined,
  });
  const selection = useFileSelection(view.items.map((item) => item.id));
  const { clear } = selection;
  useEffect(clear, [clear, view.filters, preference.pagingMode]);
  return { view, selection, preference };
}

async function renderManager() {
  const hook = renderHook(({ keyword }) => useManager(keyword), {
    initialProps: { keyword: undefined as string | undefined },
    wrapper: AllProviders,
  });
  await waitFor(() => expect(hook.result.current.view.items).toHaveLength(3));
  act(() => hook.result.current.selection.apply(['a', 'b'], 'replace'));
  expect(hook.result.current.selection.selected.size).toBe(2);
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  useFileViewPreferenceStore.setState({ ...DEFAULT_FILE_VIEW_PREFERENCE });
  fetchFolders.mockReset().mockResolvedValue({ items: [], personalFolderId: null });
  fetchFiles.mockReset().mockResolvedValue({
    items: [file('a'), file('b'), file('c')],
    pagination: { offset: 0, limit: 60, total: 3 },
    nextCursor: null,
  });
});

describe('檔案管理器的選取（docs/architecture/frontend/12-file-manager.md §4）', () => {
  it('切換排列方式（卡片／列表）：選取仍在', async () => {
    const { result } = await renderManager();
    act(() => useFileViewPreferenceStore.getState().update({ viewMode: 'list' }));
    expect(result.current.preference.viewMode).toBe('list');
    expect([...result.current.selection.selected].toSorted()).toEqual(['a', 'b']);
  });

  it('改每頁筆數（例如其他分頁改的）而排序沒變：篩選條件是同一個物件', async () => {
    const { result } = await renderManager();
    const filters = result.current.view.filters;
    act(() => useFileViewPreferenceStore.getState().update({ pageSize: 120 }));
    expect(result.current.view.filters).toBe(filters);
  });

  it('換關鍵字：選取清空（現有行為不變）', async () => {
    const { result, rerender } = await renderManager();
    rerender({ keyword: 'report' });
    await waitFor(() => expect(result.current.selection.selected.size).toBe(0));
  });

  it('換閱覽模式（分頁／無限捲動）：選取清空', async () => {
    const { result } = await renderManager();
    act(() => useFileViewPreferenceStore.getState().update({ pagingMode: 'pagination' }));
    await waitFor(() => expect(result.current.selection.selected.size).toBe(0));
  });
});
