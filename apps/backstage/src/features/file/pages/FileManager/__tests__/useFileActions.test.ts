import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FILE_MANAGER_SCOPE, FileBatchOperation } from '../../../batch';
import type { BrowserItemVM, FileItemVM, FolderItemVM } from '../adapter';
import { useFileActions } from '../useFileActions';

const { queue, deleteFile, deleteFolder, move, toast } = vi.hoisted(() => {
  return {
    toast: { info: vi.fn() },
    queue: { current: { enqueue: vi.fn() } as { enqueue: ReturnType<typeof vi.fn> } | undefined },
    deleteFile: { mutateAsync: vi.fn(), isPending: false },
    deleteFolder: { mutateAsync: vi.fn(), isPending: false },
    move: { mutateAsync: vi.fn(), isPending: false },
  };
});
vi.mock('@b2b-system/web-core/batch', () => ({ useBatchQueue: () => queue.current }));
vi.mock('@b2b-system/web-core/notify', () => ({ useToast: () => toast }));
vi.mock('@b2b-system/web-core/locales', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => `${key}:${String(options?.count)}`,
  }),
}));
vi.mock('../../../hooks/useFileMutations', () => ({ useFileDeleteMutation: () => deleteFile }));
vi.mock('../../../hooks/useFolderMutations', () => ({
  useFolderDeleteMutation: () => deleteFolder,
  useFileMoveMutation: () => move,
}));

const file = (id: string, overrides: Partial<FileItemVM> = {}) =>
  ({
    type: 'file',
    id,
    name: `${id}.txt`,
    downloadUrl: `http://s/${id}?download`,
    ...overrides,
  }) as FileItemVM;
const folder = (id: string) => ({ type: 'folder', id, name: `dir-${id}` }) as FolderItemVM;

function setup(pending: readonly BrowserItemVM[]) {
  const hook = renderHook(() => useFileActions());
  act(() => hook.result.current.requestDelete(pending));
  return hook;
}

describe('useFileActions（檔案管理器的刪除、下載與移動）', () => {
  beforeEach(() => {
    queue.current = { enqueue: vi.fn() };
    for (const mutation of [deleteFile, deleteFolder, move]) {
      mutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('單一檔案直接呼叫單筆刪除，完成後關閉確認並回傳刪除的項目', async () => {
    const target = file('a');
    const { result } = setup([target]);
    expect(result.current.pendingDelete).toEqual([target]);

    let deleted: readonly BrowserItemVM[] = [];
    await act(async () => {
      deleted = await result.current.confirmDelete();
    });

    expect(deleteFile.mutateAsync).toHaveBeenCalledWith({ params: { fileId: 'a' } });
    expect(deleteFolder.mutateAsync).not.toHaveBeenCalled();
    expect(queue.current?.enqueue).not.toHaveBeenCalled();
    expect(deleted).toEqual([target]);
    expect(result.current.pendingDelete).toBeUndefined();
  });

  it('單一資料夾呼叫資料夾刪除；失敗（已由 mutation 提示）也會關閉確認', async () => {
    deleteFolder.mutateAsync.mockRejectedValue(new Error('boom'));
    const { result } = setup([folder('d')]);

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(deleteFolder.mutateAsync).toHaveBeenCalledWith({ params: { folderId: 'd' } });
    expect(result.current.pendingDelete).toBeUndefined();
  });

  it('多個項目送進批次佇列：資料夾與檔案各一個工作', async () => {
    const { result } = setup([file('a'), folder('d'), file('b')]);
    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(queue.current?.enqueue).toHaveBeenCalledWith({
      operation: FileBatchOperation.DELETE_FOLDER,
      scope: FILE_MANAGER_SCOPE,
      items: [{ id: 'd', label: 'dir-d' }],
    });
    expect(queue.current?.enqueue).toHaveBeenCalledWith({
      operation: FileBatchOperation.DELETE,
      scope: FILE_MANAGER_SCOPE,
      items: [
        { id: 'a', label: 'a.txt' },
        { id: 'b', label: 'b.txt' },
      ],
    });
    expect(deleteFile.mutateAsync).not.toHaveBeenCalled();
  });

  it('多個項目只有檔案時只送一個工作', async () => {
    const { result } = setup([file('a'), file('b')]);
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(queue.current?.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.current?.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ operation: FileBatchOperation.DELETE }),
    );
  });

  it('多個項目但沒有批次佇列 → 不刪除，只關閉確認', async () => {
    queue.current = undefined;
    const { result } = setup([file('a'), file('b')]);
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(deleteFile.mutateAsync).not.toHaveBeenCalled();
    expect(result.current.pendingDelete).toBeUndefined();
  });

  it('取消刪除清掉待確認的項目', () => {
    const { result } = setup([file('a')]);
    act(() => result.current.cancelDelete());
    expect(result.current.pendingDelete).toBeUndefined();
  });

  it('移動一次送出所有檔案與資料夾；移到根目錄時 targetFolderId 是 null', async () => {
    const { result } = renderHook(() => useFileActions());
    const items = { fileIds: ['a'], folderIds: ['d'], sourceFolderId: 'x' };

    await act(() => result.current.moveItems(items, 'target'));
    expect(move.mutateAsync).toHaveBeenLastCalledWith({
      params: { fileIds: ['a'], folderIds: ['d'], targetFolderId: 'target' },
    });

    await act(() => result.current.moveItems(items, undefined));
    expect(move.mutateAsync).toHaveBeenLastCalledWith({
      params: { fileIds: ['a'], folderIds: ['d'], targetFolderId: null },
    });
  });

  it('拖放失敗不往外拋（錯誤已由 mutation 提示）', async () => {
    move.mutateAsync.mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useFileActions());
    expect(() =>
      result.current.dropItems({ fileIds: ['a'], folderIds: [], sourceFolderId: undefined }, 'b'),
    ).not.toThrow();
    await act(async () => {});
    expect(move.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('移動對話框：開啟與取消', () => {
    const { result } = renderHook(() => useFileActions());
    const items = { fileIds: ['a'], folderIds: [], sourceFolderId: undefined };
    act(() => result.current.requestMove(items));
    expect(result.current.pendingMove).toEqual(items);
    act(() => result.current.cancelMove());
    expect(result.current.pendingMove).toBeUndefined();
  });

  it('下載多個檔案時間隔觸發，略過沒有下載網址的檔案', async () => {
    vi.useFakeTimers();
    const clicked: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    const { result } = renderHook(() => useFileActions());

    result.current.download([file('a'), file('x', { downloadUrl: null }), file('b')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(clicked).toEqual([{ href: 'http://s/a?download', download: 'a.txt' }]);

    await vi.advanceTimersByTimeAsync(250);
    expect(clicked).toEqual([
      { href: 'http://s/a?download', download: 'a.txt' },
      { href: 'http://s/b?download', download: 'b.txt' },
    ]);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('超過上限只下載前 50 個並提示', async () => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { result } = renderHook(() => useFileActions());

    result.current.download(Array.from({ length: 60 }, (_, index) => file(`f${index}`)));
    await vi.advanceTimersByTimeAsync(60 * 250);

    expect(click).toHaveBeenCalledTimes(50);
    expect(toast.info).toHaveBeenCalledWith('file.downloadLimited:50');
  });
});
