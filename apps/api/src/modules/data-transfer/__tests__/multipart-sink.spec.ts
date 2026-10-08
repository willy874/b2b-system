import { describe, expect, it, vi } from 'vitest';

import type { ObjectStorage } from '@/core/storage';

import { MultipartSink } from '../export/multipart-sink';

const KEY = 'transfers/t-1/widgets.csv';
const CONTENT_TYPE = 'text/csv; charset=utf-8';

function setup(partBytes = 4) {
  const storage = {
    putObject: vi.fn(async () => undefined),
    createMultipartUpload: vi.fn(async () => 'upload-1'),
    uploadPart: vi.fn(
      async (_key: string, _uploadId: string, partNumber: number) => `etag-${partNumber}`,
    ),
    completeMultipartUpload: vi.fn(async () => undefined),
    abortMultipartUpload: vi.fn(async () => undefined),
  };
  const sink = new MultipartSink(storage as unknown as ObjectStorage, KEY, CONTENT_TYPE, partBytes);
  return { storage, sink };
}

/** 每次 uploadPart 收到的內容（文字）。 */
function uploadedBodies(storage: ReturnType<typeof setup>['storage']): string[] {
  return storage.uploadPart.mock.calls.map((call) => String((call as unknown[])[3]));
}

describe('MultipartSink（docs/architecture/backend/22-data-transfer.md §6.3 步驟 4、§13 D6）', () => {
  it('整個檔案小於一段時不開 multipart，結束時一次 putObject', async () => {
    const { storage, sink } = setup();
    sink.write(Buffer.from('ab'));
    sink.write(Buffer.alloc(0));
    await sink.flush();
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();

    await expect(sink.complete()).resolves.toBe(2);
    expect(storage.putObject).toHaveBeenCalledWith(KEY, Buffer.from('ab'), {
      contentType: CONTENT_TYPE,
    });
    expect(sink.size).toBe(2);
  });

  it('累積滿一段就上傳，多出的位元組留到下一段；結束時上傳剩下的並組合', async () => {
    const { storage, sink } = setup();
    sink.write(Buffer.from('abc'));
    sink.write(Buffer.from('defghij'));
    await sink.flush();

    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    expect(storage.createMultipartUpload).toHaveBeenCalledWith(KEY, { contentType: CONTENT_TYPE });
    expect(uploadedBodies(storage)).toEqual(['abcd', 'efgh']);

    await expect(sink.complete()).resolves.toBe(10);
    expect(uploadedBodies(storage)).toEqual(['abcd', 'efgh', 'ij']);
    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(KEY, 'upload-1', [
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ]);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('剛好整段時結束不再上傳空的段', async () => {
    const { storage, sink } = setup();
    sink.write(Buffer.from('abcd'));
    await sink.flush();
    await expect(sink.complete()).resolves.toBe(4);
    expect(storage.uploadPart).toHaveBeenCalledTimes(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(KEY, 'upload-1', [
      { partNumber: 1, etag: 'etag-1' },
    ]);
  });

  it('abort 放棄已上傳的段，只放棄一次', async () => {
    const { storage, sink } = setup();
    sink.write(Buffer.from('abcdef'));
    await sink.flush();
    await sink.abort();
    await sink.abort();
    expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(KEY, 'upload-1');
  });

  it('還沒開始 multipart 時 abort 不呼叫物件儲存', async () => {
    const { storage, sink } = setup();
    sink.write(Buffer.from('ab'));
    await sink.abort();
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });
});
