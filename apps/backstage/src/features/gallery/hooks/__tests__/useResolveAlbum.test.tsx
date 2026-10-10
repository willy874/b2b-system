import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { useResolveAlbum } from '../useResolveAlbum';

const api = vi.hoisted(() => ({ createAlbum: vi.fn(), invalidateResources: vi.fn() }));
vi.mock('@/apis/gallery/create-gallery-album/fetcher', () => ({
  fetchGalleryAlbumCreateMutation: api.createAlbum,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

/** 測試裡控制何時完成的 Promise（`Promise.withResolvers` 不在這個 app 的 lib 裡）。 */
function deferred<T>() {
  const handle: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((done) => {
    handle.resolve = done;
  });
  return { promise, resolve: (value: T) => handle.resolve?.(value) };
}

function render() {
  return renderHook(() => useResolveAlbum(), { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useResolveAlbum（相簿的選擇 → 相簿 id）', () => {
  it('不加入相簿 → undefined，不建立', async () => {
    const result = render();
    await expect(result.current.resolve({ kind: 'none' })).resolves.toBeUndefined();
    expect(api.createAlbum).not.toHaveBeenCalled();
  });

  it('既有的相簿 → 直接回傳它的 id，不建立', async () => {
    const result = render();
    await expect(result.current.resolve({ kind: 'existing', albumId: 'album-1' })).resolves.toBe(
      'album-1',
    );
    expect(api.createAlbum).not.toHaveBeenCalled();
  });

  it('新建 → 以去掉前後空白的名稱建立，回傳新相簿的 id', async () => {
    api.createAlbum.mockResolvedValue({ id: 'album-new', name: '活動' });
    const result = render();

    let id: string | undefined;
    await act(async () => {
      id = await result.current.resolve({ kind: 'new', name: '  活動  ' });
    });

    expect(id).toBe('album-new');
    expect(api.createAlbum.mock.calls[0]![0].params).toEqual({ body: { name: '活動' } });
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'galleryAlbum', kind: 'create', id: 'album-new' },
    ]);
  });

  it('建立中 isPending 為 true，完成後回到 false', async () => {
    const created = deferred<{ id: string; name: string }>();
    api.createAlbum.mockReturnValue(created.promise);
    const result = render();
    expect(result.current.isPending).toBe(false);

    let pending: Promise<string | undefined> | undefined;
    act(() => {
      pending = result.current.resolve({ kind: 'new', name: '活動' });
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      created.resolve({ id: 'album-new', name: '活動' });
      await pending;
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('名稱重複 → 錯誤拋給呼叫端的表單', async () => {
    api.createAlbum.mockRejectedValue(new AppError('GALLERY_ALBUM_NAME_DUPLICATE', 409));
    const result = render();

    let error: unknown;
    await act(async () => {
      error = await result.current
        .resolve({ kind: 'new', name: '活動' })
        .catch((reason: unknown) => reason);
    });

    expect(error).toMatchObject({ code: 'GALLERY_ALBUM_NAME_DUPLICATE' });
  });
});
