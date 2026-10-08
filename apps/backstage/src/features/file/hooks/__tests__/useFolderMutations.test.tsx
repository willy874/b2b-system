import { ANY_ID } from '@b2b-system/web-core/cache';
import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useFileMoveMutation,
  useFolderCreateMutation,
  useFolderDeleteMutation,
  useFolderRenameMutation,
  useFolderRestoreMutation,
} from '../useFolderMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  move: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/file/create-file-folder/fetcher', () => ({
  fetchFileFolderCreateMutation: api.create,
}));
vi.mock('@/apis/file/update-file-folder/fetcher', () => ({
  fetchFileFolderUpdateMutation: api.rename,
}));
vi.mock('@/apis/file/delete-file-folder/fetcher', () => ({
  fetchFileFolderDeleteMutation: api.remove,
}));
vi.mock('@/apis/file/restore-file-folder/fetcher', () => ({
  fetchFileFolderRestoreMutation: api.restore,
}));
vi.mock('@/apis/file/move-file-items/fetcher', () => ({ fetchFileMoveMutation: api.move }));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';
const DELETED_FOLDER = [
  { resource: 'fileFolder', kind: 'delete', id: 'f1' },
  { resource: 'file', kind: 'delete', id: ANY_ID },
];

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  resetFeatureStore();
  featureStore.setState({ resolved: true, statuses: new Map([['trash', 'ready']]) });
});

describe('useFolderCreateMutation', () => {
  it('建立成功 → 宣告 fileFolder create 並提示', async () => {
    api.create.mockResolvedValue({ id: 'f1', name: '合約' });
    const result = render(() => useFolderCreateMutation());
    act(() => result.current.mutate({ params: { name: '合約' } as never }));
    expect(await screen.findByText('已建立資料夾')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'fileFolder', kind: 'create', id: 'f1' },
    ]);
  });
});

describe('useFolderRenameMutation', () => {
  it('改名成功 → 宣告 fileFolder update 並提示', async () => {
    api.rename.mockResolvedValue({ id: 'f1', name: '新名稱' });
    const result = render(() => useFolderRenameMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } as never }));
    expect(await screen.findByText('已重新命名')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'fileFolder', kind: 'update', id: 'f1' },
    ]);
  });
});

describe('useFolderDeleteMutation', () => {
  it('刪除成功 → 資料夾與所有檔案一起失效，提示的「復原」按下就還原', async () => {
    api.remove.mockResolvedValue(undefined);
    api.restore.mockResolvedValue({ id: 'f1', name: '合約', filesSkipped: 0 });
    const result = render(() => useFolderDeleteMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } }));
    expect(await screen.findByText('已刪除資料夾')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(DELETED_FOLDER);

    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(1));
    expect(api.restore.mock.calls[0]![0].params).toEqual({ folderId: 'f1' });
  });

  it('租戶沒有啟用回收桶 → 提示沒有「復原」', async () => {
    featureStore.setState({ statuses: new Map() });
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useFolderDeleteMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } }));
    expect(await screen.findByText('已刪除資料夾')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('別人已經刪掉（FILE_FOLDER_NOT_FOUND）→ 照樣失效讓畫面跟上，並顯示錯誤', async () => {
    api.remove.mockRejectedValue(new AppError('FILE_FOLDER_NOT_FOUND', 404));
    const result = render(() => useFolderDeleteMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } }));
    expect(await screen.findByText('資料夾不存在或已被刪除。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(DELETED_FOLDER);
  });

  it('其他錯誤 → 只顯示錯誤、不失效', async () => {
    api.remove.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useFolderDeleteMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useFolderRestoreMutation', () => {
  it('全部還原 → 宣告資料夾與檔案 create，提示成功', async () => {
    api.restore.mockResolvedValue({ id: 'f1', name: '合約', filesSkipped: 0 });
    const result = render(() => useFolderRestoreMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } }));
    expect(await screen.findByText('已還原「合約」與其中的檔案、子資料夾。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'fileFolder', kind: 'create', id: 'f1' },
      { resource: 'file', kind: 'create', id: ANY_ID },
    ]);
  });

  it('有檔案內容已不在 → 警告說明略過的數量', async () => {
    api.restore.mockResolvedValue({ id: 'f1', name: '合約', filesSkipped: 2 });
    const result = render(() => useFolderRestoreMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } }));
    expect(
      await screen.findByText('已還原「合約」，其中 2 個檔案的內容已不存在，無法還原。'),
    ).toBeInTheDocument();
  });

  it('同位置已有同名資料夾 → 說明要先改名或移走', async () => {
    api.restore.mockRejectedValue(new AppError('FILE_FOLDER_NAME_CONFLICT', 409));
    const result = render(() => useFolderRestoreMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } }));
    expect(
      await screen.findByText('同一個位置已有同名的資料夾，請先把它改名或移走再還原。'),
    ).toBeInTheDocument();
  });

  it('其他錯誤 → 顯示錯誤碼的訊息', async () => {
    api.restore.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useFolderRestoreMutation());
    act(() => result.current.mutate({ params: { folderId: 'f1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useFileMoveMutation', () => {
  it('移動成功 → 失效所有資料夾與檔案，提示移動的總數', async () => {
    api.move.mockResolvedValue({ movedFiles: 2, movedFolders: 1 });
    const result = render(() => useFileMoveMutation());
    act(() => result.current.mutate({ params: {} as never }));
    expect(await screen.findByText('已移動 3 個項目')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'fileFolder', kind: 'update', id: ANY_ID },
      { resource: 'file', kind: 'update', id: ANY_ID },
    ]);
  });

  it('沒有任何項目被移動 → 只失效、不提示', async () => {
    api.move.mockResolvedValue({ movedFiles: 0, movedFolders: 0 });
    const result = render(() => useFileMoveMutation());
    act(() => result.current.mutate({ params: {} as never }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.invalidateResources).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/已移動/)).not.toBeInTheDocument();
  });

  it('失敗 → 重抓資料夾並顯示錯誤', async () => {
    api.move.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useFileMoveMutation());
    act(() => result.current.mutate({ params: {} as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'fileFolder', kind: 'update', id: ANY_ID },
    ]);
  });
});
