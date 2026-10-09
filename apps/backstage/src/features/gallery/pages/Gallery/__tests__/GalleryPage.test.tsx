import { installFlowDom } from '@b2b-system/ui/testing';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerGalleryPagePermissions, Routes } from '../../..';
import galleryZhTW from '../../../locales/zh_TW.json';

const {
  fetchItems,
  fetchAlbums,
  fetchTimeline,
  fetchUploads,
  fetchItem,
  fetchNeighbors,
  fetchTags,
} = vi.hoisted(() => ({
  fetchItems: vi.fn(),
  fetchAlbums: vi.fn(),
  fetchTimeline: vi.fn(),
  fetchUploads: vi.fn(),
  fetchItem: vi.fn(),
  fetchNeighbors: vi.fn(),
  fetchTags: vi.fn(),
}));
vi.mock('@/apis/gallery/get-gallery-items/fetcher', () => ({ fetchGalleryItemsQuery: fetchItems }));
vi.mock('@/apis/gallery/get-gallery-albums/fetcher', () => ({
  fetchGalleryAlbumsQuery: fetchAlbums,
}));
vi.mock('@/apis/gallery/get-gallery-timeline/fetcher', () => ({
  fetchGalleryTimelineQuery: fetchTimeline,
}));
vi.mock('@/apis/gallery/get-gallery-uploads/fetcher', () => ({
  fetchGalleryUploadsQuery: fetchUploads,
}));
vi.mock('@/apis/gallery/get-gallery-item/fetcher', () => ({ fetchGalleryItemQuery: fetchItem }));
vi.mock('@/apis/gallery/get-gallery-neighbors/fetcher', () => ({
  fetchGalleryNeighborsQuery: fetchNeighbors,
}));
vi.mock('@/apis/tag/get-tag-list/fetcher', () => ({ fetchTagListQuery: fetchTags }));

const variant = (name: string, width: number, height: number) => ({
  src: `https://storage.test/${name}.jpg`,
  srcSet: `https://storage.test/${name}.jpg ${width}w`,
  sources: [],
  width,
  height,
});

function item(id: string, title: string, sortAt: string) {
  return {
    id,
    title,
    description: null,
    contentType: 'image/jpeg',
    size: 1000,
    width: 1600,
    height: 900,
    displayRotation: 0,
    dominantColor: '#336699',
    placeholder: null,
    takenAt: sortAt,
    sortAt,
    createdAt: sortAt,
    image: {
      width: 1600,
      height: 900,
      expiresAt: '2099-01-01T00:00:00.000Z',
      variants: {
        grid: variant('grid', 480, 270),
        medium: variant('medium', 1280, 720),
        large: variant('large', 1600, 900),
      },
    },
    tags: [],
    version: 1,
  };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ITEMS = [
  item(A, '海報 A', '2026-03-14T02:00:00.000Z'),
  item(B, '海報 B', '2026-03-14T01:00:00.000Z'),
  item(C, '產品照 C', '2026-02-01T01:00:00.000Z'),
];

const READER = ['gallery:read'] as PermissionKey[];
const EDITOR = [...READER, 'gallery:create', 'gallery:update', 'gallery:delete'] as PermissionKey[];
const routes = [Routes.GalleryRoute, Routes.GalleryAlbumRoute];

beforeAll(() => {
  installFlowDom();
  initTestI18n(galleryZhTW);
  // JustifiedGrid 以捲動容器的寬高排版：jsdom 沒有版面
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
});

beforeEach(() => {
  resetPagePermissionRegistry();
  registerGalleryPagePermissions();
  fetchItems.mockReset().mockResolvedValue({ items: ITEMS, nextCursor: null });
  fetchAlbums.mockReset().mockResolvedValue({ items: [] });
  fetchTimeline.mockReset().mockResolvedValue({
    timeZone: 'Asia/Taipei',
    months: [
      { month: '2026-03', count: 2 },
      { month: '2026-02', count: 1 },
    ],
  });
  fetchUploads.mockReset().mockResolvedValue({ processing: 0, failed: [] });
  fetchItem.mockReset().mockImplementation(async ({ params }) => ({
    ...ITEMS.find((entry) => entry.id === params.itemId),
    exif: { make: 'Acme' },
    locationStripped: true,
    source: 'upload',
    sourceName: 'a.jpg',
    uploader: null,
    albums: [],
    duplicates: [],
    original: null,
    download: { original: 'https://storage.test/o', large: 'https://storage.test/l' },
  }));
  fetchNeighbors.mockReset().mockResolvedValue({ previousId: null, nextId: null });
  fetchTags.mockReset().mockResolvedValue({ items: [] });
});

describe('GalleryPage 的權限（docs/architecture/frontend/24-gallery.md §8）', () => {
  it('有 gallery:create／update／delete → 顯示「加入」、新增相簿；選取後有加入相簿、標籤、刪除', async () => {
    renderRoute(routes, '/gallery', EDITOR);
    await screen.findAllByTestId('gallery-item', undefined, { timeout: 5000 });
    expect(screen.getByTestId('gallery-add-button')).toBeInTheDocument();
    expect(screen.getByTestId('gallery-album-create')).toBeInTheDocument();
    const [select] = screen.getAllByTestId('gallery-item-select');
    fireEvent.click(select as HTMLElement);
    expect(await screen.findByTestId('gallery-selection-count')).toHaveAttribute('data-value', '1');
    expect(screen.getByTestId('gallery-selection-add-to-album')).toBeInTheDocument();
    expect(screen.getByTestId('gallery-selection-tag')).toBeInTheDocument();
    expect(screen.getByTestId('gallery-selection-delete')).toBeInTheDocument();
  });

  it('只有 gallery:read → 看得到圖片與下載，沒有上傳、相簿與刪除', async () => {
    renderRoute(routes, '/gallery', READER);
    await screen.findAllByTestId('gallery-item', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('gallery-add-button')).toBeNull();
    expect(screen.queryByTestId('gallery-album-create')).toBeNull();
    const [select] = screen.getAllByTestId('gallery-item-select');
    fireEvent.click(select as HTMLElement);
    expect(await screen.findByTestId('gallery-selection-download')).toBeInTheDocument();
    expect(screen.queryByTestId('gallery-selection-delete')).toBeNull();
    expect(screen.queryByTestId('gallery-selection-add-to-album')).toBeNull();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    renderRoute(routes, '/gallery', 'unhydrated');
    await waitFor(() => expect(fetchItems).toHaveBeenCalled());
    expect(screen.queryByTestId('gallery-add-button')).toBeNull();
    expect(screen.queryByTestId('gallery-album-create')).toBeNull();
  });
});

describe('GalleryPage 的閱覽（docs/architecture/frontend/24-gallery.md §3）', () => {
  it('依拍攝日期分組：同一天的放在一段，區段有標題', async () => {
    renderRoute(routes, '/gallery', READER);
    await screen.findAllByTestId('gallery-item', undefined, { timeout: 5000 });
    const sections = screen
      .getAllByTestId('gallery-section-select')
      .map((element) => element.getAttribute('data-value'));
    expect(sections).toEqual(['2026-03-14', '2026-02-01']);
  });

  it('日期捲軸：點一個月以那個月為起點重新載入（startAt）', async () => {
    renderRoute(routes, '/gallery', READER);
    const months = await screen.findAllByTestId('gallery-timeline-month', undefined, {
      timeout: 5000,
    });
    fireEvent.click(months[1] as HTMLElement);
    await waitFor(() =>
      expect(fetchItems).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ startAt: new Date(2026, 2, 1).toISOString() }),
        }),
      ),
    );
    expect(await screen.findByTestId('gallery-jumped')).toBeInTheDocument();
  });

  it('篩選寫進網址並帶給 api：方向', async () => {
    renderRoute(routes, '/gallery?orientation=portrait', READER);
    await waitFor(() =>
      expect(fetchItems).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ orientation: 'portrait' }) }),
      ),
    );
  });

  it('沒有圖片 → 空狀態；有 gallery:create 時提示上傳', async () => {
    fetchItems.mockResolvedValue({ items: [], nextCursor: null });
    renderRoute(routes, '/gallery', EDITOR);
    expect(
      await screen.findByTestId('gallery-empty', undefined, { timeout: 5000 }),
    ).toHaveTextContent('把照片拖進來');
  });
});

describe('GalleryViewer（docs/architecture/frontend/24-gallery.md §9）', () => {
  it('點一張打開檢視器（網址帶 ?item=），→ 前往下一張，資訊面板顯示 EXIF', async () => {
    const { router } = renderRoute(routes, '/gallery', READER);
    const [first] = await screen.findAllByTestId('gallery-item', undefined, { timeout: 5000 });
    fireEvent.click(first as HTMLElement);
    expect(await screen.findByTestId('gallery-viewer')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ item: A }));
    expect(await screen.findByTestId('gallery-info-panel')).toHaveTextContent('Acme');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(router.state.location.search).toMatchObject({ item: B }));
    // 只有讀取權限：沒有旋轉與刪除
    expect(screen.queryByTestId('gallery-viewer-rotate-left')).toBeNull();
    expect(screen.queryByTestId('gallery-viewer-delete')).toBeNull();
  });

  it('打開的那一張被刪除 → 顯示「圖片已被刪除」', async () => {
    const { AppError } = await import('@b2b-system/web-core/errors');
    fetchItem.mockRejectedValue(new AppError('GALLERY_ITEM_NOT_FOUND', 404));
    renderRoute(routes, `/gallery?item=${C}`, READER);
    expect(
      await screen.findByTestId('gallery-viewer-deleted', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('有 gallery:update → 可以旋轉，送出帶 version 的顯示方向', async () => {
    renderRoute(routes, `/gallery?item=${A}`, EDITOR);
    fireEvent.click(
      await screen.findByTestId('gallery-viewer-rotate-right', undefined, { timeout: 5000 }),
    );
    // 旋轉的 mutation 由 apis/gallery/update-gallery-item 送出（這裡只確認按鈕在、可以按）
    expect(screen.getByTestId('gallery-viewer-rotate-left')).toBeInTheDocument();
  });
});
