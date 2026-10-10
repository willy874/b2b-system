import { AppError } from '@b2b-system/web-core/errors';
import { describe, expect, it, vi } from 'vitest';

import { pairItemId, parsePairedItemId } from '../pairedItemId';
import { createUploadRunner } from '../uploadRunner';
import type { UploadSources } from '../uploadSources';

function setup(file: File | undefined, upload = vi.fn(async () => undefined)) {
  const store = { get: vi.fn(async () => file), delete: vi.fn(async () => undefined) };
  const onSettled = vi.fn();
  const run = createUploadRunner({
    sources: { store } as unknown as UploadSources,
    incompleteCode: 'FILE_UPLOAD_INCOMPLETE',
    upload,
    onSettled,
  });
  const context = {
    signal: new AbortController().signal,
    reportProgress: vi.fn(),
    invalidate: vi.fn(),
  };
  return { run, store, upload, onSettled, context };
}

const FILE = new File(['x'], 'a.txt');

describe('pairItemId', () => {
  it('第二個值編進 id；沒有第二個值時就是第一個', () => {
    expect(parsePairedItemId(pairItemId('src', 'folder'))).toEqual({
      first: 'src',
      second: 'folder',
    });
    expect(parsePairedItemId(pairItemId('src', undefined))).toEqual({ first: 'src' });
  });
});

describe('createUploadRunner（批次上傳一筆的共同流程）', () => {
  it('成功：以暫存檔與目的地上傳，之後重抓用量並刪掉暫存檔', async () => {
    const { run, store, upload, onSettled, context } = setup(FILE);
    await run(pairItemId('key-1', 'folder-1'), context);
    expect(upload).toHaveBeenCalledWith(FILE, 'folder-1', context);
    expect(onSettled).toHaveBeenCalledWith(context);
    expect(store.delete).toHaveBeenCalledWith('key-1');
  });

  it('拿不到暫存檔（發起的分頁已關、IndexedDB 不可用）→ 請使用者重傳', async () => {
    const { run, upload, context } = setup(undefined);
    await expect(run('key-1', context)).rejects.toMatchObject({
      code: 'FILE_UPLOAD_INCOMPLETE',
      details: { reason: 'source-unavailable' },
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('被限流：保留暫存檔讓佇列重送；其他失敗：刪掉暫存檔；兩者都重抓用量', async () => {
    const limited = setup(
      FILE,
      vi.fn(async () => Promise.reject(new AppError('RATE_LIMITED', 429))),
    );
    await expect(limited.run('key-1', limited.context)).rejects.toBeInstanceOf(AppError);
    expect(limited.store.delete).not.toHaveBeenCalled();
    expect(limited.onSettled).toHaveBeenCalled();

    const failed = setup(
      FILE,
      vi.fn(async () => Promise.reject(new AppError('INTERNAL_ERROR', 500))),
    );
    await expect(failed.run('key-1', failed.context)).rejects.toBeInstanceOf(AppError);
    expect(failed.store.delete).toHaveBeenCalledWith('key-1');
    expect(failed.onSettled).toHaveBeenCalled();
  });
});
