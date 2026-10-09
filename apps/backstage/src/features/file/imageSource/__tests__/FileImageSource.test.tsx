import type { ImageSourceItem, ImageUsage } from '@b2b-system/web-core/image-picker';
import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileFolder, StoredFile } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { FileImageSource } from '../FileImageSource';

const { fetchFiles, fetchFolders } = vi.hoisted(() => ({
  fetchFiles: vi.fn(),
  fetchFolders: vi.fn(),
}));
vi.mock('@/apis/file/get-file-list/fetcher', () => ({ fetchFileListQuery: fetchFiles }));
vi.mock('@/apis/file/get-file-folder-list/fetcher', () => ({
  fetchFileFolderListQuery: fetchFolders,
}));

const GALLERY_ITEM: ImageUsage = {
  id: 'gallery.item',
  maxSize: 1024 * 1024,
  contentTypes: ['image/jpeg', 'image/png'],
  minWidth: 200,
  minHeight: 200,
  aspectRatio: null,
  presets: {},
  sources: null,
};

function image(id: string, name: string, size = 400): StoredFile {
  return {
    id,
    name,
    contentType: 'image/png',
    size: 1,
    status: 'ready',
    folderId: null,
    url: null,
    downloadUrl: null,
    thumbnailUrl: null,
    image: {
      width: size,
      height: size,
      originalUrl: `https://files.test/${id}`,
      previewUrl: `https://files.test/${id}/preview`,
      thumbnailUrl: `https://files.test/${id}/thumb`,
      expiresAt: '',
    },
    urlExpiresAt: null,
    version: 1,
    uploader: null,
    capabilities: { canUpdate: false, canDelete: false },
    tags: [],
    uploadedAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

const ART: FileFolder = {
  id: 'art',
  name: 'Art',
  parentId: null,
  kind: 'normal',
  inheritGrants: true,
  hasPendingAccessRequest: false,
  capabilities: {
    canRead: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    canShare: false,
  },
  tags: [],
  createdAt: '',
  updatedAt: '',
};

const FILES_BY_FOLDER: Record<string, StoredFile[]> = {
  root: [image('f1', 'logo.png'), image('f2', 'tiny.png', 50)],
  art: [image('a1', 'poster.png')],
};

function page(items: StoredFile[]) {
  return {
    items,
    pagination: { offset: 0, limit: 48, total: items.length },
    nextCursor: null,
    prevCursor: null,
  };
}

/** 呼叫端（多選對話框）的角色：勾選是 refId 的集合。 */
function MultipleHost({ onToggle }: { onToggle: (item: ImageSourceItem) => void }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <>
      <span data-testid="host-count" data-value={selected.size} />
      <FileImageSource
        usage={GALLERY_ITEM}
        onSelect={() => undefined}
        multiple={{
          selected,
          onToggle: (item) => {
            onToggle(item);
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(item.refId)) next.delete(item.refId);
              else next.add(item.refId);
              return next;
            });
          },
        }}
      />
    </>
  );
}

async function fileItem(id: string) {
  return waitFor(() => {
    const element = screen
      .getAllByTestId('file-image-source-item')
      .find((candidate) => candidate.getAttribute('data-value') === id);
    if (!element) throw new Error(`找不到 ${id}`);
    return element;
  });
}

async function openFolder(id: string) {
  fireEvent.click(screen.getByTestId('file-image-source-folder'));
  await screen.findByRole('tree');
  const option = screen
    .getAllByTestId('select-item')
    .find((element) => element.getAttribute('data-value') === id);
  if (!option) throw new Error(`找不到資料夾 ${id}`);
  fireEvent.click(option);
}

describe('FileImageSource 的多選模式（docs/architecture/frontend/23-image-picker.md §2.1）', () => {
  beforeAll(() => initTestI18n(zhTW));

  beforeEach(() => {
    fetchFolders.mockReset().mockResolvedValue({
      items: [ART],
      rootCapabilities: { canCreate: false },
      personalFolderId: null,
    });
    fetchFiles
      .mockReset()
      .mockImplementation(async (request: { params: { folderId: string } }) =>
        page(FILES_BY_FOLDER[request.params.folderId] ?? []),
      );
  });

  it('點一張切換勾選（aria-pressed、data-selected），不呼叫 onSelect', async () => {
    const onToggle = vi.fn();
    renderWithPermissions(<MultipleHost onToggle={onToggle} />);

    const logo = await fileItem('f1');
    expect(logo).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(logo);
    expect(onToggle).toHaveBeenCalledWith({ refId: 'f1', name: 'logo.png' });
    await waitFor(() => expect(logo).toHaveAttribute('aria-pressed', 'true'));
    expect(logo).toHaveAttribute('data-selected', 'true');

    fireEvent.click(logo);
    await waitFor(() => expect(logo).toHaveAttribute('aria-pressed', 'false'));
    expect(logo).not.toHaveAttribute('data-selected');
  });

  it('尺寸太小的照樣停用，不能勾選', async () => {
    const onToggle = vi.fn();
    renderWithPermissions(<MultipleHost onToggle={onToggle} />);
    const tiny = await fileItem('f2');
    expect(tiny).toBeDisabled();
    fireEvent.click(tiny);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('換資料夾時保留勾選：兩個資料夾的圖可以一起選', async () => {
    renderWithPermissions(<MultipleHost onToggle={vi.fn()} />);
    fireEvent.click(await fileItem('f1'));

    await openFolder('art');
    fireEvent.click(await fileItem('a1'));
    await waitFor(() =>
      expect(screen.getByTestId('host-count')).toHaveAttribute('data-value', '2'),
    );

    await openFolder('root');
    expect(await fileItem('f1')).toHaveAttribute('aria-pressed', 'true');
  });

  it('單選模式：沒有 aria-pressed，點選呼叫 onSelect 並帶預覽', async () => {
    const onSelect = vi.fn();
    renderWithPermissions(<FileImageSource usage={GALLERY_ITEM} onSelect={onSelect} />);
    const logo = await fileItem('f1');
    expect(logo).not.toHaveAttribute('aria-pressed');
    fireEvent.click(logo);
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'source',
      source: 'file',
      refId: 'f1',
      name: 'logo.png',
      preview: { src: 'https://files.test/f1/preview', width: 400, height: 400 },
    });
  });
});
