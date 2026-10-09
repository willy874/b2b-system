import { sessionStore } from '@b2b-system/web-core/auth';
import { getBatchOperation, resetBatchOperations } from '@b2b-system/web-core/batch';
import type { BatchQueueClient } from '@b2b-system/web-core/batch';
import { AppError, isAppError } from '@b2b-system/web-core/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadFile, deleteFile, deleteFolder, fetchQuery } = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  deleteFolder: vi.fn(),
  fetchQuery: vi.fn(),
}));

vi.mock('@/apis/file/upload-file/fetcher', () => ({ uploadFile }));
vi.mock('@/apis/file/delete-file/mutation', () => ({
  getFileDeleteMutationOptions: () => ({ mutationFn: deleteFile }),
}));
vi.mock('@/apis/file/delete-file-folder/mutation', () => ({
  getFileFolderDeleteMutationOptions: () => ({ mutationFn: deleteFolder }),
}));
vi.mock('@b2b-system/web-core/cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryClient: { fetchQuery },
}));

const { registerFileBatchOperations, enqueueFileUploads, FileBatchOperation, FILE_MANAGER_SCOPE } =
  await import('../batch');
const { uploadSources, fileUploadSources } = await import('../upload/uploadSources');

/** 操作宣告的變更（`BatchRunContext.invalidate`；佇列合併後才交給依賴圖） */
const invalidate = vi.fn();
const context = () => ({
  signal: new AbortController().signal,
  reportProgress: vi.fn(),
  invalidate,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetBatchOperations();
  registerFileBatchOperations();
  fetchQuery.mockResolvedValue({ thumbnailMaxSize: 1000 });
});

describe('檔案的批次操作（docs/architecture/frontend/12-file-manager.md §14）', () => {
  it('enqueueFileUploads：檔案放進 uploadSources，佇列項目只帶 id、檔名與大小（份量）', async () => {
    const enqueue = vi.fn((_input: unknown) => 'job-1');
    const file = new File(['12345'], 'hero.png', { type: 'image/png' });
    await enqueueFileUploads({ enqueue } as unknown as BatchQueueClient, [{ file }]);

    const input = enqueue.mock.calls[0]?.[0] as {
      items: Array<{ id: string; label: string; weight: number }>;
    };
    expect(input).toMatchObject({
      operation: FileBatchOperation.UPLOAD,
      scope: FILE_MANAGER_SCOPE,
      concurrency: 3,
    });
    const [item] = input.items;
    expect(item).toMatchObject({ label: 'hero.png', weight: 5 });
    await expect(uploadSources.get(item?.id ?? '')).resolves.toBe(file);
  });

  it('上傳：從 uploadSources 取檔、回報進度、宣告新檔案（帶目的地資料夾），完成後清掉暫存的檔案', async () => {
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
    await uploadSources.put('src-1', file);
    uploadFile.mockImplementation(async ({ onProgress }: { onProgress: (p: unknown) => void }) => {
      onProgress({ loaded: 3, total: 3 });
      return { id: 'file-1' };
    });
    const ctx = context();

    await getBatchOperation(FileBatchOperation.UPLOAD)?.run('src-1', ctx);

    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ file }), ctx.signal);
    expect(ctx.reportProgress).toHaveBeenCalledWith({ loaded: 3, total: 3 });
    // 根目錄：只失效根目錄與不分資料夾的列表（apis/resources.ts 的 scopedCollection）
    expect(invalidate).toHaveBeenCalledWith([
      { resource: 'file', kind: 'create', id: 'file-1', refs: { fileFolder: ['root'] } },
    ]);
    await expect(uploadSources.get('src-1')).resolves.toBeUndefined();
  });

  it('上傳結束（成功或失敗）都重抓已用量：登記就佔用了容量（docs/architecture/05-tenancy.md §13.3 D8）', async () => {
    await uploadSources.put('src-ok', new File(['a'], 'ok.txt'));
    uploadFile.mockResolvedValueOnce({ id: 'file-ok' });
    await getBatchOperation(FileBatchOperation.UPLOAD)?.run('src-ok', context());
    await uploadSources.put('src-fail', new File(['b'], 'fail.txt'));
    uploadFile.mockRejectedValueOnce(new Error('boom'));
    await getBatchOperation(FileBatchOperation.UPLOAD)
      ?.run('src-fail', context())
      .catch(() => undefined);

    const usageCalls = invalidate.mock.calls.filter(([changes]) =>
      (changes as Array<{ resource: string }>).some(
        (change) => change.resource === 'fileStorageUsage',
      ),
    );
    expect(usageCalls).toHaveLength(2);
  });

  it('上傳到資料夾：目的地編進項目 id，上傳時帶上 folderId；結果清單顯示相對路徑', async () => {
    const enqueue = vi.fn((_input: unknown) => 'job-1');
    const file = new File(['12'], 'button.png', { type: 'image/png' });
    await enqueueFileUploads({ enqueue } as unknown as BatchQueueClient, [
      { file, folderId: 'folder-1', label: 'ui/button.png' },
    ]);
    const input = enqueue.mock.calls[0]?.[0] as { items: Array<{ id: string; label: string }> };
    const [item] = input.items;
    expect(item?.label).toBe('ui/button.png');
    uploadFile.mockResolvedValue({ id: 'file-2' });

    await getBatchOperation(FileBatchOperation.UPLOAD)?.run(item?.id ?? '', context());

    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ file, folderId: 'folder-1' }),
      expect.anything(),
    );
    expect(invalidate).toHaveBeenCalledWith([
      { resource: 'file', kind: 'create', id: 'file-2', refs: { fileFolder: ['folder-1'] } },
    ]);
  });

  it('上傳：接手的分頁拿不到檔案 → FILE_UPLOAD_INCOMPLETE（請使用者重傳）', async () => {
    const error = await getBatchOperation(FileBatchOperation.UPLOAD)
      ?.run('missing', context())
      .catch((reason: unknown) => reason);
    expect(isAppError(error) && error.code).toBe('FILE_UPLOAD_INCOMPLETE');
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('★ 主 session 結束時清掉所有排隊中的檔案（上一個人的檔案不留給下一個人）', async () => {
    const off = fileUploadSources.clearOnSessionEnd();
    await uploadSources.put('queued-1', new File(['a'], 'a.txt'));
    await uploadSources.put('queued-2', new File(['b'], 'b.txt'));
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });

    sessionStore.endSession('logout');

    await vi.waitFor(async () => {
      await expect(uploadSources.get('queued-1')).resolves.toBeUndefined();
    });
    await expect(uploadSources.get('queued-2')).resolves.toBeUndefined();
    off();
    sessionStore.clear();
  });

  it('上傳失敗也清掉暫存的檔案（佇列不自動重試）', async () => {
    await uploadSources.put('src-2', new File(['x'], 'b.txt'));
    uploadFile.mockRejectedValue(new Error('boom'));
    await expect(
      getBatchOperation(FileBatchOperation.UPLOAD)?.run('src-2', context()),
    ).rejects.toThrow();
    await expect(uploadSources.get('src-2')).resolves.toBeUndefined();
  });

  it('被限流（RATE_LIMITED）時保留暫存的檔案：佇列時間到會重送同一筆（07-ui-system.md §13.4）', async () => {
    await uploadSources.put('src-limited', new File(['x'], 'c.txt'));
    uploadFile.mockRejectedValueOnce(new AppError('RATE_LIMITED', 429, { retryAfterSeconds: 3 }));
    await expect(
      getBatchOperation(FileBatchOperation.UPLOAD)?.run('src-limited', context()),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(uploadSources.get('src-limited')).resolves.toBeInstanceOf(File);
    await uploadSources.delete('src-limited');
  });

  it('刪除：呼叫單筆 API 並失效該檔案', async () => {
    deleteFile.mockResolvedValue(undefined);
    await getBatchOperation(FileBatchOperation.DELETE)?.run('file-9', context());
    expect(deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ params: { fileId: 'file-9' } }),
    );
    expect(invalidate).toHaveBeenCalledWith([{ resource: 'file', kind: 'delete', id: 'file-9' }]);
  });

  it('刪除資料夾：呼叫單筆 API，失效資料夾與所有檔案（其中的檔案一起刪除了）', async () => {
    deleteFolder.mockResolvedValue(undefined);
    await getBatchOperation(FileBatchOperation.DELETE_FOLDER)?.run('folder-3', context());
    expect(deleteFolder).toHaveBeenCalledWith(
      expect.objectContaining({ params: { folderId: 'folder-3' } }),
    );
    expect(invalidate).toHaveBeenCalledWith([
      { resource: 'fileFolder', kind: 'delete', id: 'folder-3' },
      { resource: 'file', kind: 'delete', id: '*' },
    ]);
  });
});
