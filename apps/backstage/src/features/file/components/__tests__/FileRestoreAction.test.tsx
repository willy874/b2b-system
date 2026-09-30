import { createRoute } from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';
import type { PermissionKey } from '@/core/permission';
import { RootRoute } from '@/core/router';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { useFileDeleteMutation } from '../../hooks/useFileMutations';
import { useFolderDeleteMutation } from '../../hooks/useFolderMutations';
import fileZhTW from '../../locales/zh_TW.json';
import { FileRestoreAction } from '../FileRestoreAction';
import { FolderRestoreAction } from '../FolderRestoreAction';

const { restoreFile, restoreFolder, deleteFile, deleteFolder } = vi.hoisted(() => ({
  restoreFile: vi.fn(),
  restoreFolder: vi.fn(),
  deleteFile: vi.fn(),
  deleteFolder: vi.fn(),
}));
vi.mock('@/apis/file/restore-file/fetcher', () => ({ fetchFileRestoreMutation: restoreFile }));
vi.mock('@/apis/file/restore-file-folder/fetcher', () => ({
  fetchFileFolderRestoreMutation: restoreFolder,
}));
vi.mock('@/apis/file/delete-file/fetcher', () => ({ fetchFileDeleteMutation: deleteFile }));
vi.mock('@/apis/file/delete-file-folder/fetcher', () => ({
  fetchFileFolderDeleteMutation: deleteFolder,
}));

const FILE_ID = '77777777-7777-4777-8777-777777777777';
const FOLDER_ID = '88888888-8888-4888-8888-888888888888';
const item = (id: string, type: 'file' | 'fileFolder', name: string) => ({
  id,
  type,
  name,
  description: '/素材',
  deletedAt: '2026-09-30T00:00:00.000Z',
  deletedBy: null,
  purgeAt: '2026-10-30T00:00:00.000Z',
});
const PERMISSIONS = ['file:read', 'file:delete'] as PermissionKey[];

function DeleteButtons() {
  const removeFile = useFileDeleteMutation();
  const removeFolder = useFolderDeleteMutation();
  return (
    <>
      <button type="button" onClick={() => removeFile.mutate({ params: { fileId: FILE_ID } })}>
        delete-file
      </button>
      <button
        type="button"
        onClick={() => removeFolder.mutate({ params: { folderId: FOLDER_ID } })}
      >
        delete-folder
      </button>
    </>
  );
}

const routes = [
  createRoute({
    getParentRoute: () => RootRoute,
    path: '/restore-file',
    component: () => <FileRestoreAction item={item(FILE_ID, 'file', 'hero.png')} />,
  }),
  createRoute({
    getParentRoute: () => RootRoute,
    path: '/restore-folder',
    component: () => <FolderRestoreAction item={item(FOLDER_ID, 'fileFolder', '素材')} />,
  }),
  createRoute({ getParentRoute: () => RootRoute, path: '/delete', component: DeleteButtons }),
];

function restoredFolder(filesSkipped: number) {
  return { id: FOLDER_ID, name: '素材', foldersRestored: 2, filesRestored: 3, filesSkipped };
}

beforeAll(() => initTestI18n(fileZhTW));

beforeEach(() => {
  restoreFile.mockReset().mockResolvedValue({ id: FILE_ID, name: 'hero.png', folderId: null });
  restoreFolder.mockReset().mockResolvedValue(restoredFolder(0));
  deleteFile.mockReset().mockResolvedValue(undefined);
  deleteFolder.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('檔案的還原（docs/architecture/frontend/13-trash.md §4.2、ADR-0025 R4）', () => {
  it('按下還原 → 呼叫 POST /files/:id/restore 並提示成功', async () => {
    renderRoute(routes, '/restore-file', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('file-restore'));
    await waitFor(() => expect(restoreFile).toHaveBeenCalledTimes(1));
    expect(restoreFile.mock.calls[0]![0].params).toEqual({ fileId: FILE_ID });
    expect(await screen.findByText('已還原「hero.png」。')).toBeInTheDocument();
  });

  it('所在的資料夾已刪除（parentDeleted）→ 提示先還原資料夾', async () => {
    restoreFile.mockRejectedValue(
      new AppError('FILE_RESTORE_CONFLICT', 409, {
        reason: 'parentDeleted',
        parentType: 'fileFolder',
        parentId: FOLDER_ID,
      }),
    );
    renderRoute(routes, '/restore-file', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('file-restore'));
    expect(
      await screen.findByText('所在的資料夾已被刪除，請先在回收桶的「資料夾」分頁還原資料夾。'),
    ).toBeInTheDocument();
  });

  it('物件已不在（objectMissing）→ 說明無法救回', async () => {
    restoreFile.mockRejectedValue(
      new AppError('FILE_RESTORE_CONFLICT', 409, { reason: 'objectMissing' }),
    );
    renderRoute(routes, '/restore-file', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('file-restore'));
    expect(await screen.findByText('這個檔案的內容已不存在，無法還原。')).toBeInTheDocument();
  });

  it('刪除檔案的提示附「復原」，按下就還原剛刪除的檔案（R4b：刪除時物件保留）', async () => {
    renderRoute(routes, '/delete', PERMISSIONS);
    fireEvent.click(await screen.findByRole('button', { name: 'delete-file' }));
    expect(await screen.findByText('已刪除檔案')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: '復原' }));
    await waitFor(() => expect(restoreFile).toHaveBeenCalledTimes(1));
    expect(restoreFile.mock.calls[0]![0].params).toEqual({ fileId: FILE_ID });
  });
});

describe('資料夾的還原（docs/architecture/frontend/13-trash.md §4.2、ADR-0025 R4）', () => {
  it('按下還原 → 呼叫 POST /file-folders/:id/restore 並提示成功', async () => {
    renderRoute(routes, '/restore-folder', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('file-folder-restore'));
    await waitFor(() => expect(restoreFolder).toHaveBeenCalledTimes(1));
    expect(restoreFolder.mock.calls[0]![0].params).toEqual({ folderId: FOLDER_ID });
    expect(await screen.findByText('已還原「素材」與其中的檔案、子資料夾。')).toBeInTheDocument();
  });

  it('有檔案的內容已不在（filesSkipped）→ 提示帶數量', async () => {
    restoreFolder.mockResolvedValue(restoredFolder(2));
    renderRoute(routes, '/restore-folder', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('file-folder-restore'));
    expect(
      await screen.findByText('已還原「素材」，其中 2 個檔案的內容已不存在，無法還原。'),
    ).toBeInTheDocument();
  });

  it('同一個位置已有同名的資料夾（409）→ 說明要先改名或移走它', async () => {
    restoreFolder.mockRejectedValue(
      new AppError('FILE_FOLDER_NAME_CONFLICT', 409, { name: '素材', conflictingId: FILE_ID }),
    );
    renderRoute(routes, '/restore-folder', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('file-folder-restore'));
    expect(
      await screen.findByText('同一個位置已有同名的資料夾，請先把它改名或移走再還原。'),
    ).toBeInTheDocument();
  });

  it('上層已刪除（FILE_FOLDER_RESTORE_CONFLICT）→ 通用訊息：先還原上層', async () => {
    restoreFolder.mockRejectedValue(
      new AppError('FILE_FOLDER_RESTORE_CONFLICT', 409, {
        reason: 'parentDeleted',
        parentType: 'fileFolder',
        parentId: FILE_ID,
      }),
    );
    renderRoute(routes, '/restore-folder', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('file-folder-restore'));
    expect(await screen.findByText('上層資料夾已被刪除，請先還原上層資料夾。')).toBeInTheDocument();
  });

  it('刪除資料夾的提示附「復原」，按下就還原剛刪除的資料夾', async () => {
    renderRoute(routes, '/delete', PERMISSIONS);
    fireEvent.click(await screen.findByRole('button', { name: 'delete-folder' }));

    fireEvent.click(await screen.findByRole('button', { name: '復原' }));
    await waitFor(() => expect(restoreFolder).toHaveBeenCalledTimes(1));
    expect(restoreFolder.mock.calls[0]![0].params).toEqual({ folderId: FOLDER_ID });
  });
});
