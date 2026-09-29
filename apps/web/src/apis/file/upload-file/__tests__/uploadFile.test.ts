import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isNetworkError, isRequestAborted } from '@/core/client';
import { isAppError } from '@/core/errors';
import type { FileUpload, StoredFile } from '@/shared/api-sdk';

import { uploadFile } from '../fetcher';
import { putToStorage } from '../putToStorage';
import {
  fetchFileAbortUploadMutation,
  fetchFileCompleteUploadMutation,
  fetchFileCreateUploadMutation,
  fetchFileCreateUploadPartsMutation,
} from '../steps';
import { uploadParts } from '../uploadParts';

vi.mock('../steps', () => ({
  fetchFileCreateUploadMutation: vi.fn(),
  fetchFileCreateUploadPartsMutation: vi.fn(),
  fetchFileCompleteUploadMutation: vi.fn(),
  fetchFileAbortUploadMutation: vi.fn(),
}));

const storedFile = (status: StoredFile['status']): StoredFile => ({
  id: 'file-1',
  name: 'hero.png',
  contentType: 'image/png',
  size: 4,
  status,
  folderId: null,
  url: status === 'ready' ? 'http://localhost/storage/b/files/file-1?inline' : null,
  downloadUrl: null,
  thumbnailUrl: null,
  image: null,
  urlExpiresAt: null,
  version: 1,
  uploader: null,
  uploadedAt: null,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
});

const uploadTarget: NonNullable<FileUpload['upload']> = {
  url: 'http://localhost/storage/b/files/file-1?X-Amz-Signature=abc',
  method: 'PUT',
  headers: { 'Content-Type': 'image/png' },
  expiresAt: '2026-09-27T00:15:00.000Z',
};

/** 只實作 putToStorage 用到的部分；`respond()` 由測試決定何時、以什麼狀態結束。 */
class FakeXhr {
  static last: FakeXhr | undefined;
  static all: FakeXhr[] = [];
  readonly upload = new EventTarget();
  readonly events = new EventTarget();
  readonly headers: Record<string, string> = {};
  method = '';
  url = '';
  body: unknown;
  status = 0;

  responseHeaders: Record<string, string> = {};

  constructor() {
    FakeXhr.last = this;
    FakeXhr.all.push(this);
  }

  getResponseHeader(name: string) {
    return this.responseHeaders[name] ?? null;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  addEventListener(type: string, listener: EventListener) {
    this.events.addEventListener(type, listener);
  }

  send(body: unknown) {
    this.body = body;
  }

  abort() {
    this.events.dispatchEvent(new Event('abort'));
  }

  progress(loaded: number, total: number) {
    this.upload.dispatchEvent(
      Object.assign(new Event('progress'), { loaded, total, lengthComputable: true }),
    );
  }

  respond(status: number, headers: Record<string, string> = {}) {
    this.status = status;
    this.responseHeaders = headers;
    this.events.dispatchEvent(new Event('load'));
  }

  fail() {
    this.events.dispatchEvent(new Event('error'));
  }
}

function currentXhr(): FakeXhr {
  if (!FakeXhr.last) throw new Error('XHR 尚未建立');
  return FakeXhr.last;
}

/** 等 uploadFile 內部的 await 走到發出 XHR。 */
async function untilXhrSent() {
  await vi.waitFor(() => expect(FakeXhr.last?.body).toBeDefined());
}

beforeEach(() => {
  FakeXhr.last = undefined;
  FakeXhr.all = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.mocked(fetchFileCreateUploadMutation).mockResolvedValue({
    file: storedFile('pending'),
    upload: uploadTarget,
    multipart: null,
    thumbnailUpload: null,
  });
  vi.mocked(fetchFileCompleteUploadMutation).mockResolvedValue(storedFile('ready'));
  vi.mocked(fetchFileAbortUploadMutation).mockResolvedValue(undefined);
  vi.mocked(fetchFileCreateUploadPartsMutation).mockImplementation(async ({ params }) => ({
    parts: params.partNumbers.map((partNumber) => ({
      partNumber,
      url: `http://localhost/storage/b/files/file-1?partNumber=${partNumber}`,
      method: 'PUT' as const,
      headers: {},
    })),
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('uploadFile（登記 → 直傳 → 完成）', () => {
  it('依序完成三步，回傳 ready 的檔案；直傳帶上簽過的標頭', async () => {
    const file = new File(['data'], 'hero.png', { type: 'image/png' });
    const progress = vi.fn();
    const result = uploadFile({ file, onProgress: progress });

    await untilXhrSent();
    const xhr = currentXhr();
    expect(fetchFileCreateUploadMutation).toHaveBeenCalledWith({
      params: { name: 'hero.png', contentType: 'image/png', size: 4 },
      signal: undefined,
    });
    expect(xhr).toMatchObject({ method: 'PUT', url: uploadTarget.url, body: file });
    expect(xhr.headers).toEqual({ 'Content-Type': 'image/png' });

    xhr.progress(2, 4);
    expect(progress).toHaveBeenCalledWith({ loaded: 2, total: 4 });
    xhr.respond(200);

    await expect(result).resolves.toMatchObject({ id: 'file-1', status: 'ready' });
    expect(fetchFileCompleteUploadMutation).toHaveBeenCalledWith({
      params: { fileId: 'file-1', body: undefined },
      signal: undefined,
    });
    expect(fetchFileAbortUploadMutation).not.toHaveBeenCalled();
  });

  it('瀏覽器沒給型別時以 application/octet-stream 登記；Blob 要自己給檔名', async () => {
    const result = uploadFile({ file: new Blob(['data']), name: 'raw.bin' });
    await untilXhrSent();
    currentXhr().respond(200);
    await result;
    expect(fetchFileCreateUploadMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { name: 'raw.bin', contentType: 'application/octet-stream', size: 4 },
      }),
    );

    await expect(uploadFile({ file: new Blob(['x']) })).rejects.toThrow(TypeError);
  });

  it('物件儲存回非 2xx → FILE_UPLOAD_INCOMPLETE，不呼叫 complete', async () => {
    const result = uploadFile({ file: new File(['data'], 'a.png', { type: 'image/png' }) });
    await untilXhrSent();
    currentXhr().respond(403);

    const error = await result.catch((reason: unknown) => reason);
    expect(isAppError(error) && error.code).toBe('FILE_UPLOAD_INCOMPLETE');
    expect(fetchFileCompleteUploadMutation).not.toHaveBeenCalled();
    // 登記後失敗：放棄這次上傳，不留下 pending 紀錄
    expect(fetchFileAbortUploadMutation).toHaveBeenCalledWith({ params: { fileId: 'file-1' } });
  });

  it('被中止 → RequestAbortedError，並放棄上傳（清理請求不用已中止的 signal）', async () => {
    const controller = new AbortController();
    const result = uploadFile({ file: new File(['data'], 'a.png') }, controller.signal);
    await untilXhrSent();
    controller.abort();
    expect(isRequestAborted(await result.catch((reason: unknown) => reason))).toBe(true);
    expect(fetchFileAbortUploadMutation).toHaveBeenCalledWith({ params: { fileId: 'file-1' } });
  });

  it('帶縮圖：登記時附上縮圖資訊，並與本體一起直傳；縮圖失敗不影響結果', async () => {
    vi.mocked(fetchFileCreateUploadMutation).mockResolvedValueOnce({
      file: storedFile('pending'),
      upload: uploadTarget,
      multipart: null,
      thumbnailUpload: { ...uploadTarget, url: 'http://localhost/storage/b/thumbnails/file-1' },
    });
    const thumbnail = new Blob(['t'], { type: 'image/webp' });
    const result = uploadFile({ file: new File(['data'], 'a.png'), thumbnail });
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(2));
    expect(fetchFileCreateUploadMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ thumbnail: { contentType: 'image/webp', size: 1 } }),
      }),
    );
    const [thumb, main] = FakeXhr.all;
    thumb?.fail();
    main?.respond(200);
    await expect(result).resolves.toMatchObject({ status: 'ready' });
  });

  it('縮圖型別不在後端白名單 → 不送縮圖', async () => {
    const result = uploadFile({
      file: new File(['data'], 'a.png'),
      thumbnail: new Blob(['t'], { type: 'image/gif' }),
    });
    await untilXhrSent();
    currentXhr().respond(200);
    await result;
    expect(vi.mocked(fetchFileCreateUploadMutation).mock.calls[0]?.[0].params).not.toHaveProperty(
      'thumbnail',
    );
  });

  it('連線失敗 → NetworkError', async () => {
    const result = uploadFile({ file: new File(['data'], 'a.png') });
    await untilXhrSent();
    currentXhr().fail();
    expect(isNetworkError(await result.catch((reason: unknown) => reason))).toBe(true);
  });
});

describe('uploadParts（分塊上傳，docs/architecture/backend/09-file.md §5.2）', () => {
  const plan = { partSize: 4, partCount: 3 };
  const file = new Blob(['aaaabbbbcc']);
  const noWait = () => Promise.resolve();

  it('依切法切塊並行直傳，回傳依塊號排序的 ETag；進度是各塊的總和', async () => {
    const progress = vi.fn();
    const result = uploadParts('file-1', plan, file, { onProgress: progress, concurrency: 2 });
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(2));
    expect(fetchFileCreateUploadPartsMutation).toHaveBeenCalledTimes(1);
    const [first, second] = FakeXhr.all;
    expect((first?.body as Blob | undefined)?.size).toBe(4);

    second?.respond(200, { ETag: '"e2"' });
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(3));
    const third = FakeXhr.all[2];
    expect((third?.body as Blob | undefined)?.size).toBe(2);
    third?.respond(200, { ETag: '"e3"' });
    first?.respond(200, { ETag: '"e1"' });

    await expect(result).resolves.toEqual([
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 3, etag: '"e3"' },
    ]);
    expect(progress).toHaveBeenLastCalledWith({ loaded: 10, total: 10 });
  });

  it('網路錯誤只重試那一塊', async () => {
    const result = uploadParts('file-1', { partSize: 10, partCount: 1 }, file, { wait: noWait });
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(1));
    FakeXhr.all[0]?.fail();
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(2));
    FakeXhr.all[1]?.respond(200, { ETag: '"ok"' });
    await expect(result).resolves.toEqual([{ partNumber: 1, etag: '"ok"' }]);
  });

  it('4xx 不重試；一塊失敗就中止其他塊', async () => {
    const result = uploadParts('file-1', plan, file, { concurrency: 2, wait: noWait });
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(2));
    const aborted = vi.fn();
    FakeXhr.all[1]?.events.addEventListener('abort', aborted);
    FakeXhr.all[0]?.respond(403);
    const error = await result.catch((reason: unknown) => reason);
    expect(isAppError(error) && error.code).toBe('FILE_UPLOAD_INCOMPLETE');
    expect(aborted).toHaveBeenCalled();
  });
});

describe('putToStorage', () => {
  it('signal 中止時取消上傳並以 RequestAbortedError 結束', async () => {
    const controller = new AbortController();
    const result = putToStorage(uploadTarget, new Blob(['data']), { signal: controller.signal });
    controller.abort();
    expect(isRequestAborted(await result.catch((reason: unknown) => reason))).toBe(true);
  });

  it('已中止的 signal 不會發出請求', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = putToStorage(uploadTarget, new Blob(['data']), { signal: controller.signal });
    expect(isRequestAborted(await result.catch((reason: unknown) => reason))).toBe(true);
    expect(FakeXhr.last).toBeUndefined();
  });
});
