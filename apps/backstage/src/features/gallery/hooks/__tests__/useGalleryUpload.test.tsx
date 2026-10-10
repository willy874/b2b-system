import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGalleryUpload } from '../useGalleryUpload';

const { queue, toast, enqueueGalleryUploads, fetchUploads } = vi.hoisted(() => ({
  queue: { current: { enqueue: vi.fn() } as { enqueue: ReturnType<typeof vi.fn> } | undefined },
  toast: { info: vi.fn(), error: vi.fn() },
  enqueueGalleryUploads: vi.fn(),
  fetchUploads: vi.fn(),
}));
vi.mock('@b2b-system/web-core/batch', () => ({ useBatchQueue: () => queue.current }));
vi.mock('@b2b-system/web-core/notify', () => ({ useToast: () => toast }));
vi.mock('@b2b-system/web-core/locales', () => ({
  useTranslation: () => ({
    // 帶參數時把參數接在 key 後面，看得出傳了什麼
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}${JSON.stringify(options)}` : key,
  }),
}));
vi.mock('../../batch', () => ({ enqueueGalleryUploads }));
vi.mock('@/apis/gallery/get-gallery-uploads/fetcher', () => ({
  fetchGalleryUploadsQuery: fetchUploads,
}));

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (name: string, extraBytes = 0) =>
  new File(
    [new Uint8Array([...PNG_HEADER, ...Array.from({ length: extraBytes }, () => 0)])],
    name,
    {
      type: 'image/png',
    },
  );
const heic = (name: string) => new File(['x'], name, { type: 'image/heic' });

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useGalleryUpload(), { wrapper }).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  queue.current = { enqueue: vi.fn() };
  fetchUploads.mockResolvedValue({ maxItemSize: 1024 });
  enqueueGalleryUploads.mockResolvedValue('job-1');
});

describe('useGalleryUpload（docs/architecture/frontend/24-gallery.md §4）', () => {
  it('通過檢查的檔案帶目的地相簿送進佇列，提示加入了幾張', async () => {
    const a = png('a.png');
    const b = png('b.png');
    const upload = setup();

    const result = await upload([a, b], 'album-1');

    expect(result).toEqual({ accepted: [a, b], rejected: [] });
    expect(enqueueGalleryUploads).toHaveBeenCalledWith(queue.current, [
      { file: a, albumId: 'album-1' },
      { file: b, albumId: 'album-1' },
    ]);
    expect(toast.info).toHaveBeenCalledWith('gallery.upload.queued{"count":2}');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('拖曳收集到的檔案（CollectedUpload）：只取檔案、不保留資料夾結構；沒有相簿時 albumId 為 undefined', async () => {
    const a = png('a.png');
    const upload = setup();

    await upload(
      {
        entries: [{ file: a, directories: ['素材', 'ui'] }],
        directories: [['素材'], ['素材', 'ui']],
      },
      undefined,
    );

    expect(enqueueGalleryUploads).toHaveBeenCalledWith(queue.current, [
      { file: a, albumId: undefined },
    ]);
  });

  it('有不能上傳的：以 toast 列出張數與第一個原因，其餘照樣送進佇列', async () => {
    const ok = png('ok.png');
    const upload = setup();

    const result = await upload([heic('IMG_1.heic'), ok, heic('IMG_2.heic')], undefined);

    expect(result.accepted).toEqual([ok]);
    expect(result.rejected.map((entry) => entry.file.name)).toEqual(['IMG_1.heic', 'IMG_2.heic']);
    expect(toast.error).toHaveBeenCalledWith(
      'gallery.upload.rejected{"count":2,"name":"IMG_1.heic","reason":"gallery.upload.heic"}',
    );
    expect(enqueueGalleryUploads).toHaveBeenCalledWith(queue.current, [
      { file: ok, albumId: undefined },
    ]);
  });

  it('超過租戶的單檔上限（GET /gallery/items/uploads 的 maxItemSize）：選檔時就擋下，原因帶上限', async () => {
    fetchUploads.mockResolvedValue({ maxItemSize: 4 });
    const upload = setup();

    const result = await upload([png('big.png')], undefined);

    expect(result.rejected[0]).toMatchObject({
      reasonKey: 'gallery.upload.tooLarge',
      reasonParams: { max: '4 B' },
    });
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"gallery.upload.tooLarge{\\"max\\":\\"4 B\\"}"'),
    );
  });

  it('拿不到單檔上限：不檢查大小，交給後端', async () => {
    fetchUploads.mockRejectedValue(new Error('offline'));
    const big = png('big.png', 4096);
    const upload = setup();

    const result = await upload([big], undefined);

    expect(result).toEqual({ accepted: [big], rejected: [] });
    expect(enqueueGalleryUploads).toHaveBeenCalledTimes(1);
  });

  it('全部不能上傳：不碰佇列、不提示加入', async () => {
    const upload = setup();

    const result = await upload([heic('a.heic')], 'album-1');

    expect(result.accepted).toEqual([]);
    expect(enqueueGalleryUploads).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('沒有選到檔案：什麼都不做', async () => {
    const upload = setup();

    expect(await upload([], undefined)).toEqual({ accepted: [], rejected: [] });
    expect(enqueueGalleryUploads).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('批次佇列沒有註冊：有要上傳的檔案時拋錯（程式的設定錯誤）', async () => {
    queue.current = undefined;
    const upload = setup();

    await expect(upload([png('a.png')], undefined)).rejects.toThrow('批次佇列尚未註冊');
    expect(enqueueGalleryUploads).not.toHaveBeenCalled();
  });
});
