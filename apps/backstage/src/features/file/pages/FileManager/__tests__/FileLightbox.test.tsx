import { AppError } from '@b2b-system/web-core/errors';
import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerFilePreviewer, resetFileRegistry } from '@/core/file';

import type { FileItemVM } from '../adapter';
import { FileLightbox } from '../components/FileLightbox';

const { fetchDetail } = vi.hoisted(() => ({ fetchDetail: vi.fn() }));
vi.mock('@/apis/file/get-file-detail/query', () => ({
  getFileDetailQueryOptions: (fileId: string) => ({
    queryKey: ['FILE_DETAIL_QUERY_KEY', fileId],
    queryFn: () => fetchDetail(fileId),
  }),
}));

const item = (id: string, overrides: Partial<FileItemVM> = {}): FileItemVM => ({
  type: 'file',
  id,
  name: `${id}.png`,
  contentType: 'image/png',
  kind: 'image',
  icon: 'file-image',
  size: 10,
  sizeLabel: '10 B',
  previewUrl: null,
  displayUrl: null,
  url: `http://s/${id}`,
  downloadUrl: `http://s/${id}?download`,
  version: 1,
  uploaderName: 'Alice',
  canUpdate: true,
  canDelete: true,
  tags: [],
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
  ...overrides,
});

const ITEMS = [
  item('a'),
  item('b'),
  item('c', { name: 'c.bin', contentType: 'application/x-bin' }),
];

function renderLightbox(
  fileId: string,
  permissions: { canRename?: boolean; canDelete?: boolean } = {},
) {
  const props = { onNavigate: vi.fn(), onClose: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() };
  renderWithPermissions(
    <FileLightbox
      fileId={fileId}
      items={ITEMS}
      canRename={permissions.canRename ?? true}
      canDelete={permissions.canDelete ?? true}
      {...props}
    />,
  );
  return props;
}

beforeEach(() => {
  resetFileRegistry();
  fetchDetail.mockReturnValue(new Promise(() => {}));
  registerFilePreviewer({
    id: 'fake-image',
    canPreview: (file) => file.contentType.startsWith('image/'),
    component: ({ file }) => <p data-testid="fake-preview">{file.name}</p>,
  });
});

describe('FileLightbox（檔案詳情）', () => {
  it('以註冊表中能處理的解析器顯示內容，並顯示第幾個／共幾個', async () => {
    renderLightbox('b');
    expect(await screen.findByTestId('fake-preview')).toHaveTextContent('b.png');
    expect(screen.getByTestId('file-lightbox-title')).toHaveTextContent('2 / 3');
  });

  it('沒有解析器能處理 → 顯示無法預覽', async () => {
    renderLightbox('c');
    expect(await screen.findByTestId('file-preview-unavailable')).toBeInTheDocument();
  });

  it('解析器超過大小上限 → 不載入內容', async () => {
    resetFileRegistry();
    registerFilePreviewer({
      id: 'tiny',
      canPreview: () => true,
      maxSize: 5,
      component: () => <p data-testid="fake-preview" />,
    });
    renderLightbox('a');
    expect(await screen.findByTestId('file-preview-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('fake-preview')).not.toBeInTheDocument();
  });

  it('解析器壞掉只影響預覽區', async () => {
    resetFileRegistry();
    registerFilePreviewer({
      id: 'broken',
      canPreview: () => true,
      component: () => {
        throw new Error('boom');
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLightbox('a');
    expect(await screen.findByTestId('file-preview-unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('file-details')).toBeInTheDocument();
  });

  it('上一個／下一個：第一個沒有上一個', async () => {
    const { onNavigate } = renderLightbox('a');
    expect(await screen.findByTestId('file-lightbox-previous')).toBeDisabled();
    screen.getByTestId('file-lightbox-next').click();
    expect(onNavigate).toHaveBeenCalledWith('b');
  });

  it('別人刪除了（詳情 404）→ 顯示已刪除，隱藏操作', async () => {
    fetchDetail.mockRejectedValue(new AppError('FILE_NOT_FOUND', 404));
    renderLightbox('a');
    expect(await screen.findByTestId('file-preview-deleted')).toBeInTheDocument();
    expect(screen.queryByTestId('file-lightbox-delete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('file-lightbox-download')).not.toBeInTheDocument();
  });

  it('沒有改名、刪除權限 → 不顯示那兩個按鈕，下載仍可用', async () => {
    renderLightbox('a', { canRename: false, canDelete: false });
    expect(await screen.findByTestId('file-lightbox-download')).toBeInTheDocument();
    expect(screen.queryByTestId('file-lightbox-rename')).not.toBeInTheDocument();
    expect(screen.queryByTestId('file-lightbox-delete')).not.toBeInTheDocument();
  });
});

describe('FileLightbox 的操作與鍵盤', () => {
  it('← / → 切換上一個、下一個；在輸入框裡不攔截', async () => {
    const { onNavigate } = renderLightbox('b');
    await screen.findByTestId('fake-preview');
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onNavigate).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(onNavigate).toHaveBeenLastCalledWith('c');

    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    input.remove();
  });

  it('最後一個按 → 不動；按上一個切到前一個', async () => {
    const { onNavigate } = renderLightbox('c');
    expect(await screen.findByTestId('file-lightbox-next')).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('file-lightbox-previous'));
    expect(onNavigate).toHaveBeenCalledWith('b');
  });

  it('改名、刪除把目前的檔案交給呼叫端；下載連結帶檔名', async () => {
    const { onRename, onDelete } = renderLightbox('a');
    fireEvent.click(await screen.findByTestId('file-lightbox-rename'));
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    fireEvent.click(screen.getByTestId('file-lightbox-delete'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    const download = screen.getByTestId('file-lightbox-download');
    expect(download).toHaveAttribute('href', 'http://s/a?download');
    expect(download).toHaveAttribute('download', 'a.png');
  });

  it('詳情回來後以最新的名稱顯示', async () => {
    fetchDetail.mockResolvedValue({
      id: 'a',
      name: 'renamed.png',
      contentType: 'image/png',
      size: 10,
      folderId: null,
      url: 'http://s/a',
      downloadUrl: 'http://s/a?download',
      thumbnailUrl: null,
      image: null,
      version: 2,
      uploader: { id: 'u1', displayName: 'Alice' },
      capabilities: { canUpdate: false, canDelete: false },
      tags: [],
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
    });
    renderLightbox('a');
    await waitFor(() =>
      expect(screen.getByTestId('file-lightbox-title')).toHaveTextContent('renamed.png'),
    );
    expect(screen.getByTestId('file-details')).toHaveTextContent('renamed.png');
    // 最新的 capabilities 不允許改名與刪除
    expect(screen.queryByTestId('file-lightbox-rename')).toBeNull();
    expect(screen.queryByTestId('file-lightbox-delete')).toBeNull();
  });

  it('先把相鄰的圖片抓進快取', async () => {
    const sources: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      set(value: string) {
        sources.push(value);
      },
      get() {
        return '';
      },
    });
    try {
      renderLightbox('b');
      await screen.findByTestId('fake-preview');
      expect(sources).toEqual(expect.arrayContaining(['http://s/a', 'http://s/c']));
    } finally {
      if (descriptor) Object.defineProperty(HTMLImageElement.prototype, 'src', descriptor);
    }
  });

  it('沒有開啟（fileId 是 undefined）→ 不查詢、不顯示', () => {
    fetchDetail.mockClear();
    renderWithPermissions(
      <FileLightbox
        fileId={undefined}
        items={ITEMS}
        canRename
        canDelete
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('file-lightbox')).toBeNull();
    expect(fetchDetail).not.toHaveBeenCalled();
  });
});
