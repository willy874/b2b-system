import type { ObjectStorage, UploadedPart } from '@/core/storage';

import type { ByteSink } from './export-writers';

/**
 * 把寫檔器的輸出分段上傳到物件儲存（docs/architecture/backend/22-data-transfer.md §6.3 步驟 4、§12 D6）：
 * 累積到 `partBytes` 就以伺服器端的 multipart 上傳一段，整份檔案不放記憶體。
 * 整個檔案小於一段時不開 multipart，結束時一次 `putObject`。
 */
export class MultipartSink implements ByteSink {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private uploadId: string | null = null;
  private readonly parts: UploadedPart[] = [];
  private total = 0;

  constructor(
    private readonly storage: ObjectStorage,
    private readonly key: string,
    private readonly contentType: string,
    private readonly partBytes: number,
  ) {}

  write(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    this.total += chunk.length;
  }

  get size(): number {
    return this.total;
  }

  /** 把累積滿的段上傳；寫檔器每寫完一頁呼叫一次。 */
  async flush(): Promise<void> {
    while (this.buffered >= this.partBytes) {
      const all = Buffer.concat(this.chunks);
      const part = all.subarray(0, this.partBytes);
      const rest = all.subarray(this.partBytes);
      this.chunks = rest.length ? [Buffer.from(rest)] : [];
      this.buffered = rest.length;
      await this.uploadPart(Buffer.from(part));
    }
  }

  private async uploadPart(body: Buffer): Promise<void> {
    this.uploadId ??= await this.storage.createMultipartUpload(this.key, {
      contentType: this.contentType,
    });
    const partNumber = this.parts.length + 1;
    const etag = await this.storage.uploadPart(this.key, this.uploadId, partNumber, body);
    this.parts.push({ partNumber, etag });
  }

  /** 上傳剩下的位元組並組合成物件。 */
  async complete(): Promise<number> {
    const rest = Buffer.concat(this.chunks);
    this.chunks = [];
    this.buffered = 0;
    if (!this.uploadId) {
      await this.storage.putObject(this.key, rest, { contentType: this.contentType });
      return this.total;
    }
    if (rest.length) await this.uploadPart(rest);
    await this.storage.completeMultipartUpload(this.key, this.uploadId, this.parts);
    return this.total;
  }

  /** 例外時放棄已上傳的段（重試時從頭產生、覆寫同一個 key）。 */
  async abort(): Promise<void> {
    if (!this.uploadId) return;
    const uploadId = this.uploadId;
    this.uploadId = null;
    await this.storage.abortMultipartUpload(this.key, uploadId);
  }
}
