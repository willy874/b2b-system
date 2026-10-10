import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerGalleryPagePermissions } from '../..';
import galleryZhTW from '../../locales/zh_TW.json';
import { AddToGalleryDialog } from '../AddToGalleryDialog';

const { fetchUploads, fetchAlbums, addFromSource } = vi.hoisted(() => ({
  fetchUploads: vi.fn(),
  fetchAlbums: vi.fn(),
  addFromSource: vi.fn(),
}));
vi.mock('@/apis/gallery/get-gallery-uploads/fetcher', () => ({
  fetchGalleryUploadsQuery: fetchUploads,
}));
vi.mock('@/apis/gallery/get-gallery-albums/fetcher', () => ({
  fetchGalleryAlbumsQuery: fetchAlbums,
}));
vi.mock('@/apis/gallery/create-gallery-from-source/fetcher', () => ({
  fetchGalleryFromSourceMutation: addFromSource,
}));

const MIB = 1024 * 1024;
const FILES = [
  { id: 'small', name: 'small.jpg', contentType: 'image/jpeg', size: 5 * MIB },
  { id: 'big', name: 'big.jpg', contentType: 'image/jpeg', size: 80 * MIB },
];

beforeAll(() => initTestI18n(galleryZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerGalleryPagePermissions();
  fetchUploads.mockReset().mockResolvedValue({ processing: 0, failed: [], maxItemSize: 50 * MIB });
  fetchAlbums.mockReset().mockResolvedValue({ items: [] });
  addFromSource.mockReset().mockResolvedValue({
    results: [{ refId: 'small', status: 'added', itemId: 'i1', name: 'small.jpg', reason: null }],
  });
});

function renderDialog() {
  return renderWithPermissions(
    <AddToGalleryDialog files={FILES} skipped={[]} sourceId="file" onClose={vi.fn()} />,
    ['gallery:read', 'gallery:create'] as PermissionKey[],
  );
}

describe('AddToGalleryDialog 的單檔上限（docs/architecture/frontend/24-gallery.md §6）', () => {
  it('超過租戶上限的檔案先略過，只送出其他的；結果列出被略過的原因', async () => {
    renderDialog();
    expect(await screen.findByTestId('gallery-add-from-file-will-skip')).toBeInTheDocument();
    const submit = screen.getByTestId('gallery-add-from-file-submit');
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(addFromSource).toHaveBeenCalled());
    expect(addFromSource.mock.calls[0]![0].params.body.refIds).toEqual(['small']);
    expect(await screen.findByTestId('gallery-add-from-file-skipped')).toHaveTextContent('big.jpg');
  });

  it('租戶上限調大：原本 50 MiB 擋下的檔案可以加入', async () => {
    fetchUploads.mockResolvedValue({ processing: 0, failed: [], maxItemSize: 200 * MIB });
    renderDialog();
    const submit = await screen.findByTestId('gallery-add-from-file-submit');
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByTestId('gallery-add-from-file-will-skip')).toBeNull();
    fireEvent.click(submit);
    await waitFor(() => expect(addFromSource).toHaveBeenCalled());
    expect(addFromSource.mock.calls[0]![0].params.body.refIds).toEqual(['small', 'big']);
  });
});
