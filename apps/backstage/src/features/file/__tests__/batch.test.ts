import { getBatchOperation, resetBatchOperations } from '@b2b-system/web-core/batch';
import type { BatchQueueClient } from '@b2b-system/web-core/batch';
import { isAppError } from '@b2b-system/web-core/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadFile, deleteFile, deleteFolder, invalidateResources, fetchQuery } = vi.hoisted(
  () => ({
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    deleteFolder: vi.fn(),
    invalidateResources: vi.fn(),
    fetchQuery: vi.fn(),
  }),
);

vi.mock('@/apis/file/upload-file/fetcher', () => ({ uploadFile }));
vi.mock('@/apis/file/delete-file/mutation', () => ({
  getFileDeleteMutationOptions: () => ({ mutationFn: deleteFile }),
}));
vi.mock('@/apis/file/delete-file-folder/mutation', () => ({
  getFileFolderDeleteMutationOptions: () => ({ mutationFn: deleteFolder }),
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources,
}));
vi.mock('@b2b-system/web-core/cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryClient: { fetchQuery },
}));

const { registerFileBatchOperations, enqueueFileUploads, FileBatchOperation, FILE_MANAGER_SCOPE } =
  await import('../batch');
const { uploadSources } = await import('../upload/uploadSources');

const context = () => ({ signal: new AbortController().signal, reportProgress: vi.fn() });

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

  it('上傳：從 uploadSources 取檔、回報進度、失效列表，完成後清掉暫存的檔案', async () => {
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
    expect(invalidateResources).toHaveBeenCalledWith([
      { resource: 'file', kind: 'create', id: 'file-1' },
    ]);
    await expect(uploadSources.get('src-1')).resolves.toBeUndefined();
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
  });

  it('上傳：接手的分頁拿不到檔案 → FILE_UPLOAD_INCOMPLETE（請使用者重傳）', async () => {
    const error = await getBatchOperation(FileBatchOperation.UPLOAD)
      ?.run('missing', context())
      .catch((reason: unknown) => reason);
    expect(isAppError(error) && error.code).toBe('FILE_UPLOAD_INCOMPLETE');
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('上傳失敗也清掉暫存的檔案（佇列不自動重試）', async () => {
    await uploadSources.put('src-2', new File(['x'], 'b.txt'));
    uploadFile.mockRejectedValue(new Error('boom'));
    await expect(
      getBatchOperation(FileBatchOperation.UPLOAD)?.run('src-2', context()),
    ).rejects.toThrow();
    await expect(uploadSources.get('src-2')).resolves.toBeUndefined();
  });

  it('刪除：呼叫單筆 API 並失效該檔案', async () => {
    deleteFile.mockResolvedValue(undefined);
    await getBatchOperation(FileBatchOperation.DELETE)?.run('file-9', context());
    expect(deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ params: { fileId: 'file-9' } }),
    );
    expect(invalidateResources).toHaveBeenCalledWith([
      { resource: 'file', kind: 'delete', id: 'file-9' },
    ]);
  });

  it('刪除資料夾：呼叫單筆 API，失效資料夾與所有檔案（其中的檔案一起刪除了）', async () => {
    deleteFolder.mockResolvedValue(undefined);
    await getBatchOperation(FileBatchOperation.DELETE_FOLDER)?.run('folder-3', context());
    expect(deleteFolder).toHaveBeenCalledWith(
      expect.objectContaining({ params: { folderId: 'folder-3' } }),
    );
    expect(invalidateResources).toHaveBeenCalledWith([
      { resource: 'fileFolder', kind: 'delete', id: 'folder-3' },
      { resource: 'file', kind: 'delete', id: '*' },
    ]);
  });
});
