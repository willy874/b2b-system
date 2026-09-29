import { Readable } from 'node:stream';

import { AppException } from '@/core/errors';
import { ObjectStorage } from '@/core/storage';
import type {
  CreateMultipartUploadOptions,
  ListedObject,
  PendingMultipartUpload,
  PresignDownloadOptions,
  PresignedRequest,
  PresignUploadOptions,
  StoredObjectHead,
  UploadedPart,
} from '@/core/storage';

/**
 * 記憶體版的物件儲存：api 的整合測試不起 apps/file-storage（apps 之間不互相依賴），
 * 「瀏覽器直傳」以 `simulateBrowserUpload` 直接寫進來代替。
 * 與真實 S3 的相容性由 apps/file-storage 的測試（官方 SDK）負責。
 */
export class InMemoryObjectStorage extends ObjectStorage {
  readonly objects = new Map<string, StoredObjectHead>();
  /** 有實際內容的物件（影像測試用）；其他物件只有 head，讀出來是全零。 */
  readonly contents = new Map<string, Buffer>();
  readonly modifiedAt = new Map<string, Date>();
  readonly deleted: string[] = [];

  async ensureBucket(): Promise<void> {}

  async ping(): Promise<boolean> {
    return true;
  }

  async head(key: string): Promise<StoredObjectHead | undefined> {
    return this.objects.get(key);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
    this.contents.delete(key);
    this.modifiedAt.delete(key);
    this.deleted.push(key);
  }

  async getObject(key: string): Promise<Readable | undefined> {
    const head = this.objects.get(key);
    if (!head) return undefined;
    return Readable.from([this.contents.get(key) ?? Buffer.alloc(head.size)]);
  }

  async putObject(key: string, body: Buffer, options: { contentType: string }): Promise<void> {
    this.write(key, body, options.contentType);
  }

  async *listObjects(prefix: string): AsyncIterable<ListedObject> {
    for (const [key, head] of [...this.objects].toSorted(([a], [b]) => a.localeCompare(b))) {
      if (!key.startsWith(prefix)) continue;
      yield { key, size: head.size, lastModified: this.modifiedAt.get(key) ?? new Date() };
    }
  }

  async *listMultipartUploads(prefix: string): AsyncIterable<PendingMultipartUpload> {
    for (const [uploadId, upload] of this.uploads) {
      if (upload.key.startsWith(prefix)) {
        yield { key: upload.key, uploadId, initiatedAt: upload.initiatedAt };
      }
    }
  }

  /** 寫入一個有內容的物件（模擬瀏覽器直傳真正的圖片）。 */
  write(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { size: body.length, etag: `etag-${key}`, contentType });
    this.contents.set(key, body);
    this.modifiedAt.set(key, new Date());
  }

  async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedRequest> {
    return {
      url: `http://storage.test/${key}?signed=put`,
      method: 'PUT',
      headers: { 'Content-Type': options.contentType },
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
  }

  async presignDownload(key: string, options: PresignDownloadOptions): Promise<PresignedRequest> {
    return {
      url: `http://storage.test/${key}?signed=${options.disposition}`,
      method: 'GET',
      headers: {},
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
  }

  /** uploadId → { key, contentType, 已上傳的塊（塊號 → 大小） } */
  readonly uploads = new Map<
    string,
    { key: string; contentType: string; parts: Map<number, number>; initiatedAt: Date }
  >();

  async createMultipartUpload(key: string, options: CreateMultipartUploadOptions): Promise<string> {
    const uploadId = `upload-${this.uploads.size + 1}`;
    this.uploads.set(uploadId, {
      key,
      contentType: options.contentType,
      parts: new Map(),
      initiatedAt: new Date(),
    });
    return uploadId;
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    options: { expiresIn: number },
  ): Promise<PresignedRequest> {
    return {
      url: `http://storage.test/${key}?uploadId=${uploadId}&partNumber=${partNumber}`,
      method: 'PUT',
      headers: {},
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly UploadedPart[],
  ): Promise<void> {
    const upload = this.uploads.get(uploadId);
    const missing = parts.some((part) => !upload?.parts.has(part.partNumber));
    if (!upload || upload.key !== key || missing) throw new AppException('FILE_UPLOAD_INCOMPLETE');
    const size = parts.reduce((sum, part) => sum + (upload.parts.get(part.partNumber) ?? 0), 0);
    this.objects.set(key, {
      size,
      etag: `etag-${key}-${parts.length}`,
      contentType: upload.contentType,
    });
    this.uploads.delete(uploadId);
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    this.uploads.delete(uploadId);
  }

  /** 從 presigned URL 取出 key，模擬瀏覽器照著網址 PUT（分塊網址則記下那一塊）。 */
  simulateBrowserUpload(url: string, size: number, contentType?: string): void {
    const parsed = new URL(url);
    const uploadId = parsed.searchParams.get('uploadId');
    if (uploadId) {
      this.uploads.get(uploadId)?.parts.set(Number(parsed.searchParams.get('partNumber')), size);
      return;
    }
    const key = parsed.pathname.slice(1);
    this.objects.set(key, { size, etag: 'etag-' + key, contentType });
    this.modifiedAt.set(key, new Date());
  }
}
