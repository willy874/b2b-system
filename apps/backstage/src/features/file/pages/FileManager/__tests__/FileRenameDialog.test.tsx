import { AppError } from '@b2b-system/web-core/errors';
import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import fileZhTW from '../../../locales/zh_TW.json';
import type { FileItemVM } from '../adapter';
import { FileRenameDialog } from '../components/FileRenameDialog';

const { updateFile, fetchFile } = vi.hoisted(() => ({
  updateFile: vi.fn(),
  fetchFile: vi.fn(),
}));
vi.mock('@/apis/file/update-file/fetcher', () => ({ fetchFileUpdateMutation: updateFile }));
vi.mock('@/apis/file/get-file-detail/fetcher', () => ({ fetchFileDetailQuery: fetchFile }));

const file = (overrides: Partial<FileItemVM> = {}): FileItemVM => ({
  type: 'file',
  id: 'f1',
  name: '合約.pdf',
  contentType: 'application/pdf',
  kind: 'pdf',
  icon: 'file',
  size: 1024,
  sizeLabel: '1 KB',
  previewUrl: null,
  displayUrl: null,
  url: null,
  downloadUrl: null,
  version: 1,
  uploaderName: null,
  canUpdate: true,
  canDelete: true,
  tags: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const typeName = (value: string) =>
  fireEvent.change(screen.getByTestId('file-rename-input'), { target: { value } });

beforeAll(() => initTestI18n(fileZhTW));

beforeEach(() => {
  updateFile.mockReset().mockResolvedValue({ id: 'f1' });
  fetchFile.mockReset();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
});

describe('FileRenameDialog（docs/architecture/backend/03-api-conventions.md §11）', () => {
  it('開啟後列表資料被重抓（別人改了名）：送出仍帶開啟時的 version', async () => {
    const onClose = vi.fn();
    const { rerender } = renderWithPermissions(
      <FileRenameDialog file={file()} onClose={onClose} />,
    );
    typeName('合約-v2.pdf');
    // 推播讓列表重抓：同一個檔案的名稱與版本號都變了
    rerender(
      <FileRenameDialog file={file({ name: '合約-final.pdf', version: 2 })} onClose={onClose} />,
    );

    expect(screen.getByTestId('file-rename-input')).toHaveValue('合約-v2.pdf');
    fireEvent.click(screen.getByTestId('file-rename-submit'));
    await waitFor(() => expect(updateFile).toHaveBeenCalledTimes(1));
    expect(updateFile.mock.calls[0]![0]).toMatchObject({
      params: { fileId: 'f1', body: { name: '合約-v2.pdf', version: 1 } },
    });
  });

  it('409 衝突：顯示 VersionConflictAlert 並保留輸入；按「重新載入」才換成最新的名稱與版本', async () => {
    updateFile.mockRejectedValueOnce(new AppError('FILE_VERSION_CONFLICT', 409, { current: 3 }));
    fetchFile.mockResolvedValue({ id: 'f1', name: '合約-final.pdf', version: 3 });
    const onClose = vi.fn();
    renderWithPermissions(<FileRenameDialog file={file()} onClose={onClose} />);
    typeName('合約-v2.pdf');
    fireEvent.click(screen.getByTestId('file-rename-submit'));

    expect(await screen.findByTestId('version-conflict-alert')).toBeInTheDocument();
    expect(screen.getByTestId('file-rename-input')).toHaveValue('合約-v2.pdf');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('version-conflict-reload'));
    await waitFor(() =>
      expect(screen.getByTestId('file-rename-input')).toHaveValue('合約-final.pdf'),
    );
    expect(screen.queryByTestId('version-conflict-alert')).not.toBeInTheDocument();

    typeName('合約-v3.pdf');
    fireEvent.click(screen.getByTestId('file-rename-submit'));
    await waitFor(() => expect(updateFile).toHaveBeenCalledTimes(2));
    expect(updateFile.mock.calls[1]![0]).toMatchObject({
      params: { fileId: 'f1', body: { name: '合約-v3.pdf', version: 3 } },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
