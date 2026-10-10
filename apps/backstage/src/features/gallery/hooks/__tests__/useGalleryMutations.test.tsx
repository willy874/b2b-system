import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useGalleryAlbumAddItemsMutation,
  useGalleryAlbumCreateMutation,
  useGalleryAlbumDeleteMutation,
  useGalleryAlbumRemoveItemsMutation,
  useGalleryAlbumRestoreMutation,
  useGalleryAlbumUpdateMutation,
  useGalleryClearFailedMutation,
  useGalleryFromSourceMutation,
  useGalleryItemDeleteMutation,
  useGalleryItemRestoreMutation,
  useGalleryItemTagsMutation,
  useGalleryItemUpdateMutation,
} from '../useGalleryMutations';

const api = vi.hoisted(() => ({
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  replaceTags: vi.fn(),
  clearFailed: vi.fn(),
  fromSource: vi.fn(),
  createAlbum: vi.fn(),
  updateAlbum: vi.fn(),
  deleteAlbum: vi.fn(),
  restoreAlbum: vi.fn(),
  addItems: vi.fn(),
  removeItems: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/gallery/update-gallery-item/fetcher', () => ({
  fetchGalleryItemUpdateMutation: api.updateItem,
}));
vi.mock('@/apis/gallery/delete-gallery-item/fetcher', () => ({
  fetchGalleryItemDeleteMutation: api.deleteItem,
}));
vi.mock('@/apis/gallery/restore-gallery-item/fetcher', () => ({
  fetchGalleryItemRestoreMutation: api.restoreItem,
}));
vi.mock('@/apis/tag/replace-resource-tags/fetcher', () => ({
  fetchResourceTagsReplaceMutation: api.replaceTags,
}));
vi.mock('@/apis/gallery/clear-gallery-failed/fetcher', () => ({
  fetchGalleryClearFailedMutation: api.clearFailed,
}));
vi.mock('@/apis/gallery/create-gallery-from-source/fetcher', () => ({
  fetchGalleryFromSourceMutation: api.fromSource,
}));
vi.mock('@/apis/gallery/create-gallery-album/fetcher', () => ({
  fetchGalleryAlbumCreateMutation: api.createAlbum,
}));
vi.mock('@/apis/gallery/update-gallery-album/fetcher', () => ({
  fetchGalleryAlbumUpdateMutation: api.updateAlbum,
}));
vi.mock('@/apis/gallery/delete-gallery-album/fetcher', () => ({
  fetchGalleryAlbumDeleteMutation: api.deleteAlbum,
}));
vi.mock('@/apis/gallery/restore-gallery-album/fetcher', () => ({
  fetchGalleryAlbumRestoreMutation: api.restoreAlbum,
}));
vi.mock('@/apis/gallery/add-gallery-album-items/fetcher', () => ({
  fetchGalleryAlbumAddItemsMutation: api.addItems,
}));
vi.mock('@/apis/gallery/remove-gallery-album-items/fetcher', () => ({
  fetchGalleryAlbumRemoveItemsMutation: api.removeItems,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';
const ITEM_CONFLICT_MESSAGE = '這張圖片已被其他人修改，請重新整理後再試。';
const ALBUM_CONFLICT_MESSAGE = '這個相簿已被其他人修改，請重新整理後再試。';

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

function withTrash(enabled: boolean): void {
  featureStore.setState({
    resolved: true,
    statuses: new Map(enabled ? [['trash', 'ready']] : []),
  });
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  resetFeatureStore();
  withTrash(true);
});

describe('useGalleryItemUpdateMutation', () => {
  it('改標題／說明 → 宣告那一張改了，提示「已更新」', async () => {
    api.updateItem.mockResolvedValue({ id: 'item-1' });
    const result = render(() => useGalleryItemUpdateMutation());
    act(() =>
      result.current.mutate({ params: { itemId: 'item-1', body: { title: 'A', version: 1 } } }),
    );
    expect(await screen.findByText('已更新')).toBeInTheDocument();
    expect(api.updateItem.mock.calls[0]![0].params).toEqual({
      itemId: 'item-1',
      body: { title: 'A', version: 1 },
    });
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryItem', kind: 'update', id: 'item-1' },
    ]);
  });

  it('改顯示方向 → 提示新的版本處理中', async () => {
    api.updateItem.mockResolvedValue({ id: 'item-1' });
    const result = render(() => useGalleryItemUpdateMutation());
    act(() =>
      result.current.mutate({
        params: { itemId: 'item-1', body: { displayRotation: 90, version: 1 } },
      }),
    );
    expect(await screen.findByText('已調整方向，新的版本處理中')).toBeInTheDocument();
  });

  it('版本衝突 → 失效那一張讓畫面拿到最新版本，並顯示錯誤', async () => {
    api.updateItem.mockRejectedValue(new AppError('GALLERY_ITEM_VERSION_CONFLICT', 409));
    const result = render(() => useGalleryItemUpdateMutation());
    act(() =>
      result.current.mutate({ params: { itemId: 'item-1', body: { title: 'A', version: 1 } } }),
    );
    expect(await screen.findByText(ITEM_CONFLICT_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryItem', kind: 'update', id: 'item-1' },
    ]);
  });

  it('其他錯誤 → 只顯示錯誤、不失效', async () => {
    api.updateItem.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useGalleryItemUpdateMutation());
    act(() =>
      result.current.mutate({ params: { itemId: 'item-1', body: { title: 'A', version: 1 } } }),
    );
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useGalleryItemDeleteMutation', () => {
  it('刪除成功 → 宣告那一張刪除了，提示「移到回收桶」', async () => {
    api.deleteItem.mockResolvedValue(undefined);
    const result = render(() => useGalleryItemDeleteMutation());
    act(() => result.current.mutate({ params: { itemId: 'item-1' } }));
    expect(await screen.findByText('圖片已移到回收桶')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryItem', kind: 'delete', id: 'item-1' },
    ]);
  });

  it('回收桶被關掉 → 不說「已移到回收桶」', async () => {
    withTrash(false);
    api.deleteItem.mockResolvedValue(undefined);
    const result = render(() => useGalleryItemDeleteMutation());
    act(() => result.current.mutate({ params: { itemId: 'item-1' } }));
    expect(await screen.findByText('圖片已刪除')).toBeInTheDocument();
  });

  it('失敗 → 顯示錯誤、不失效', async () => {
    api.deleteItem.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useGalleryItemDeleteMutation());
    act(() => result.current.mutate({ params: { itemId: 'item-1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useGalleryItemRestoreMutation', () => {
  it('還原成功 → 以 create 宣告並提示標題', async () => {
    api.restoreItem.mockResolvedValue({ id: 'item-1', title: '海報' });
    const result = render(() => useGalleryItemRestoreMutation());
    act(() => result.current.mutate({ params: { itemId: 'item-1' } }));
    expect(await screen.findByText('已還原「海報」')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryItem', kind: 'create', id: 'item-1' },
    ]);
  });

  it('失敗 → 顯示錯誤', async () => {
    api.restoreItem.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useGalleryItemRestoreMutation());
    act(() => result.current.mutate({ params: { itemId: 'item-1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useGalleryItemTagsMutation', () => {
  it('整批取代 galleryItem 的標籤 → 宣告那一張改了並提示', async () => {
    api.replaceTags.mockResolvedValue({ tags: [] });
    const result = render(() => useGalleryItemTagsMutation());
    const params = { resourceType: 'galleryItem', resourceId: 'item-1', tagIds: ['t1'] };
    act(() => result.current.mutate({ params } as never));
    expect(await screen.findByText('已更新標籤')).toBeInTheDocument();
    expect(api.replaceTags.mock.calls[0]![0].params).toEqual(params);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryItem', kind: 'update', id: 'item-1' },
    ]);
  });

  it('失敗 → 錯誤交給對話框（不彈 toast）', async () => {
    api.replaceTags.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useGalleryItemTagsMutation());
    act(() =>
      result.current.mutate({
        params: { resourceType: 'galleryItem', resourceId: 'item-1', tagIds: [] },
      } as never),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
  });
});

describe('useGalleryClearFailedMutation', () => {
  it('清除失敗的紀錄 → 宣告圖片庫的項目刪除了（不帶 id）', async () => {
    api.clearFailed.mockResolvedValue(undefined);
    const result = render(() => useGalleryClearFailedMutation());
    act(() => result.current.mutate({ params: {} } as never));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.clearFailed).toHaveBeenCalledTimes(1);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryItem', kind: 'delete' },
    ]);
  });

  it('失敗 → 顯示錯誤', async () => {
    api.clearFailed.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useGalleryClearFailedMutation());
    act(() => result.current.mutate({ params: {} } as never));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useGalleryFromSourceMutation', () => {
  it('從其他來源加入 → 只讓「處理中」的計數更新（不帶 id），結果交給呼叫端', async () => {
    const response = { added: 2, skipped: [] };
    api.fromSource.mockResolvedValue(response);
    const result = render(() => useGalleryFromSourceMutation());
    act(() => result.current.mutate({ params: { body: { items: [] } } } as never));
    await waitFor(() => expect(result.current.data).toBe(response));
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryItem', kind: 'update' },
    ]);
  });

  it('失敗 → 錯誤交給呼叫端（不彈 toast）', async () => {
    api.fromSource.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useGalleryFromSourceMutation());
    act(() => result.current.mutate({ params: { body: { items: [] } } } as never));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useGalleryAlbumCreateMutation', () => {
  it('建立成功 → 宣告新相簿並提示名稱', async () => {
    api.createAlbum.mockResolvedValue({ id: 'album-1', name: '活動' });
    const result = render(() => useGalleryAlbumCreateMutation());
    act(() => result.current.mutate({ params: { body: { name: '活動' } } }));
    expect(await screen.findByText('已建立相簿「活動」')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryAlbum', kind: 'create', id: 'album-1' },
    ]);
  });

  it('名稱重複 → 錯誤交給表單（不彈 toast）', async () => {
    api.createAlbum.mockRejectedValue(new AppError('GALLERY_ALBUM_NAME_DUPLICATE', 409));
    const result = render(() => useGalleryAlbumCreateMutation());
    act(() => result.current.mutate({ params: { body: { name: '活動' } } }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(screen.queryByText('已經有同名的相簿。')).not.toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useGalleryAlbumUpdateMutation', () => {
  it('更新成功 → 宣告那個相簿改了並提示', async () => {
    api.updateAlbum.mockResolvedValue({ id: 'album-1', name: '活動' });
    const result = render(() => useGalleryAlbumUpdateMutation());
    act(() =>
      result.current.mutate({
        params: { albumId: 'album-1', body: { name: '活動', version: 1 } },
      } as never),
    );
    expect(await screen.findByText('相簿已更新')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryAlbum', kind: 'update', id: 'album-1' },
    ]);
  });

  it('版本衝突 → 失效那個相簿，錯誤交給表單（不彈 toast）', async () => {
    api.updateAlbum.mockRejectedValue(new AppError('GALLERY_ALBUM_VERSION_CONFLICT', 409));
    const result = render(() => useGalleryAlbumUpdateMutation());
    act(() =>
      result.current.mutate({
        params: { albumId: 'album-1', body: { name: '活動', version: 1 } },
      } as never),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryAlbum', kind: 'update', id: 'album-1' },
    ]);
    expect(screen.queryByText(ALBUM_CONFLICT_MESSAGE)).not.toBeInTheDocument();
  });

  it('其他錯誤 → 不失效', async () => {
    api.updateAlbum.mockRejectedValue(new AppError('GALLERY_ALBUM_NAME_DUPLICATE', 409));
    const result = render(() => useGalleryAlbumUpdateMutation());
    act(() =>
      result.current.mutate({
        params: { albumId: 'album-1', body: { name: '活動', version: 1 } },
      } as never),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useGalleryAlbumDeleteMutation', () => {
  it('刪除成功 → 宣告那個相簿刪除了，提示「移到回收桶」', async () => {
    api.deleteAlbum.mockResolvedValue(undefined);
    const result = render(() => useGalleryAlbumDeleteMutation());
    act(() => result.current.mutate({ params: { albumId: 'album-1' } }));
    expect(await screen.findByText('相簿已移到回收桶')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryAlbum', kind: 'delete', id: 'album-1' },
    ]);
  });

  it('回收桶被關掉 → 提示「相簿已刪除」', async () => {
    withTrash(false);
    api.deleteAlbum.mockResolvedValue(undefined);
    const result = render(() => useGalleryAlbumDeleteMutation());
    act(() => result.current.mutate({ params: { albumId: 'album-1' } }));
    expect(await screen.findByText('相簿已刪除')).toBeInTheDocument();
  });

  it('失敗 → 顯示錯誤、不失效', async () => {
    api.deleteAlbum.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useGalleryAlbumDeleteMutation());
    act(() => result.current.mutate({ params: { albumId: 'album-1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useGalleryAlbumRestoreMutation', () => {
  it('還原成功 → 以 create 宣告並提示相簿名稱', async () => {
    api.restoreAlbum.mockResolvedValue({ id: 'album-1', name: '活動' });
    const result = render(() => useGalleryAlbumRestoreMutation());
    act(() => result.current.mutate({ params: { albumId: 'album-1' } }));
    expect(await screen.findByText('已還原「活動」')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryAlbum', kind: 'create', id: 'album-1' },
    ]);
  });

  it('失敗 → 顯示錯誤', async () => {
    api.restoreAlbum.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useGalleryAlbumRestoreMutation());
    act(() => result.current.mutate({ params: { albumId: 'album-1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe.each([
  {
    name: 'useGalleryAlbumAddItemsMutation',
    useHook: useGalleryAlbumAddItemsMutation,
    fetcher: api.addItems,
    message: '已加入 3 張',
  },
  {
    name: 'useGalleryAlbumRemoveItemsMutation',
    useHook: useGalleryAlbumRemoveItemsMutation,
    fetcher: api.removeItems,
    message: '已移出 3 張',
  },
])('$name', ({ useHook, fetcher, message }) => {
  const params = { albumId: 'album-1', body: { itemIds: ['a', 'b', 'c'] } };

  it('成功 → 宣告那個相簿與所有圖片改了（張數、封面、所屬相簿），提示實際變動的張數', async () => {
    fetcher.mockResolvedValue({ changed: 3 });
    const result = render(() => useHook());
    act(() => result.current.mutate({ params } as never));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(fetcher.mock.calls[0]![0].params).toEqual(params);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryAlbum', kind: 'update', id: 'album-1' },
      { resource: 'galleryItem', kind: 'update' },
    ]);
  });

  it('失敗 → 顯示錯誤、不失效', async () => {
    fetcher.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useHook());
    act(() => result.current.mutate({ params } as never));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});
