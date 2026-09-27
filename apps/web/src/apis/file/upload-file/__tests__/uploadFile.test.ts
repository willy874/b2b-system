import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isNetworkError, isRequestAborted } from '@/core/client';
import { isAppError } from '@/core/errors';
import type { FileUpload, StoredFile } from '@/shared/api-sdk';

import { uploadFile } from '../fetcher';
import { putToStorage } from '../putToStorage';
import { fetchFileCompleteUploadMutation, fetchFileCreateUploadMutation } from '../steps';

vi.mock('../steps', () => ({
  fetchFileCreateUploadMutation: vi.fn(),
  fetchFileCompleteUploadMutation: vi.fn(),
}));

const storedFile = (status: StoredFile['status']): StoredFile => ({
  id: 'file-1',
  name: 'hero.png',
  contentType: 'image/png',
  size: 4,
  status,
  url: status === 'ready' ? 'http://localhost/storage/b/files/file-1?inline' : null,
  downloadUrl: null,
  urlExpiresAt: null,
  uploader: null,
  uploadedAt: null,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
});

const uploadTarget: FileUpload['upload'] = {
  url: 'http://localhost/storage/b/files/file-1?X-Amz-Signature=abc',
  method: 'PUT',
  headers: { 'Content-Type': 'image/png' },
  expiresAt: '2026-09-27T00:15:00.000Z',
};

/** 只實作 putToStorage 用到的部分；`respond()` 由測試決定何時、以什麼狀態結束。 */
class FakeXhr {
  static last: FakeXhr | undefined;
  readonly upload = new EventTarget();
  readonly events = new EventTarget();
  readonly headers: Record<string, string> = {};
  method = '';
  url = '';
  body: unknown;
  status = 0;

  constructor() {
    FakeXhr.last = this;
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

  respond(status: number) {
    this.status = status;
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
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.mocked(fetchFileCreateUploadMutation).mockResolvedValue({
    file: storedFile('pending'),
    upload: uploadTarget,
  });
  vi.mocked(fetchFileCompleteUploadMutation).mockResolvedValue(storedFile('ready'));
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
      params: { fileId: 'file-1' },
      signal: undefined,
    });
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
  });

  it('連線失敗 → NetworkError', async () => {
    const result = uploadFile({ file: new File(['data'], 'a.png') });
    await untilXhrSent();
    currentXhr().fail();
    expect(isNetworkError(await result.catch((reason: unknown) => reason))).toBe(true);
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
