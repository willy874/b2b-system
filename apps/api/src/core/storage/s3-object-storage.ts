import type { Readable } from 'node:stream';

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { AppException } from '../errors';
import { contentDisposition } from './content-disposition';
import { ObjectStorage, stableSigningDate } from './object-storage';
import type {
  CreateMultipartUploadOptions,
  ListedObject,
  PendingMultipartUpload,
  PresignDownloadOptions,
  PresignedRequest,
  PresignUploadOptions,
  StoredObjectHead,
  UploadedPart,
} from './object-storage';

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.$metadata.httpStatusCode === 404 ||
      error.name === 'NotFound' ||
      error.name === 'NoSuchKey' ||
      error.name === 'NoSuchBucket')
  );
}

/** CompleteMultipartUpload 因「客戶端交來的塊不對」而失敗：重新上傳即可，不是儲存服務故障。 */
const INVALID_PARTS_ERRORS = new Set([
  'InvalidPart',
  'InvalidPartOrder',
  'EntityTooSmall',
  'NoSuchUpload',
]);

function stripQuotes(etag: string | undefined): string {
  return (etag ?? '').replaceAll('"', '');
}

/**
 * `ObjectStorage` 的 S3 實作（`@aws-sdk/client-s3`）。
 * 本機連 apps/file-storage，正式環境可直接指向 S3 / MinIO / R2——只改環境變數。
 */
@Injectable()
export class S3ObjectStorage
  extends ObjectStorage
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(S3ObjectStorage.name);
  private readonly bucket: string;
  private readonly isTest: boolean;
  /** api 自己發請求用（容器內網位址）。 */
  private readonly client: S3Client;
  /**
   * 只用來簽 presigned URL（瀏覽器看到的位址）。簽章包含 host 與路徑，
   * 所以不能拿內網的 client 簽完再換網址。
   */
  private readonly presigner: S3Client;
  private bucketReady: Promise<void> | undefined;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.bucket = config.get('FILE_STORAGE_BUCKET', { infer: true });
    this.isTest = config.get('NODE_ENV', { infer: true }) === 'test';
    const common: S3ClientConfig = {
      region: config.get('FILE_STORAGE_REGION', { infer: true }),
      // apps/file-storage 只支援 path-style；S3 也支援，統一用它
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('FILE_STORAGE_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('FILE_STORAGE_SECRET_ACCESS_KEY', { infer: true }),
      },
      // SDK 預設會替 PutObject 加上 CRC32 checksum：presigned PUT 會被簽進「空 body 的 checksum」，
      // 瀏覽器實際上傳的內容對不上就被 S3 拒絕。只在 API 要求時才算。
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    this.client = new S3Client({
      ...common,
      endpoint: config.get('FILE_STORAGE_ENDPOINT', { infer: true }),
    });
    this.presigner = new S3Client({
      ...common,
      endpoint: config.get('FILE_STORAGE_PUBLIC_ENDPOINT', { infer: true }),
    });
  }

  onApplicationBootstrap(): void {
    // 儲存服務還沒起來不該擋住整個 api（RBAC 與檔案無關）；第一次用到檔案時會再試
    if (this.isTest) return;
    this.ensureBucket().catch((error: unknown) => {
      this.logger.warn({ err: error }, '啟動時無法確認 bucket，第一次存取檔案時會重試');
    });
  }

  onApplicationShutdown(): void {
    this.client.destroy();
    this.presigner.destroy();
  }

  ensureBucket(): Promise<void> {
    this.bucketReady ??= this.createBucketIfMissing().catch((error: unknown) => {
      this.bucketReady = undefined;
      throw error;
    });
    return this.bucketReady;
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  async head(key: string): Promise<StoredObjectHead | undefined> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: result.ContentLength ?? 0,
        etag: stripQuotes(result.ETag),
        contentType: result.ContentType,
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw this.unavailable(error, 'head');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (isNotFound(error)) return;
      throw this.unavailable(error, 'delete');
    }
  }

  async getObject(key: string): Promise<Readable | undefined> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      // Node.js 執行環境下 Body 是 IncomingMessage（Readable）
      return result.Body as Readable | undefined;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw this.unavailable(error, 'getObject');
    }
  }

  async putObject(key: string, body: Buffer, options: { contentType: string }): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
        }),
      );
    } catch (error) {
      throw this.unavailable(error, 'putObject');
    }
  }

  async *listObjects(prefix: string): AsyncIterable<ListedObject> {
    let continuationToken: string | undefined;
    do {
      let page;
      try {
        // oxlint-disable-next-line no-await-in-loop -- 下一頁要用這一頁的 continuation token
        page = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
      } catch (error) {
        throw this.unavailable(error, 'listObjects');
      }
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        yield {
          key: object.Key,
          size: object.Size ?? 0,
          lastModified: object.LastModified ?? new Date(0),
        };
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedRequest> {
    const url = await getSignedUrl(
      this.presigner,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: options.contentType }),
      // 把 Content-Type 簽進去：瀏覽器換了型別就上傳失敗，存下來的型別一定是登記的那個
      { expiresIn: options.expiresIn, signableHeaders: new Set(['content-type']) },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': options.contentType },
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
  }

  async presignDownload(key: string, options: PresignDownloadOptions): Promise<PresignedRequest> {
    const signingDate = stableSigningDate(Date.now(), options.expiresIn);
    const expiresAt = new Date(signingDate.getTime() + options.expiresIn * 1000);
    const url = await getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(options.disposition, options.fileName),
        // 物件內容以 id 為 key、永不覆寫：在網址有效期間內可以放心快取
        ResponseCacheControl: `private, max-age=${Math.floor(options.expiresIn / 2)}, immutable`,
      }),
      { expiresIn: options.expiresIn, signingDate },
    );
    return { url, method: 'GET', headers: {}, expiresAt };
  }

  async createMultipartUpload(key: string, options: CreateMultipartUploadOptions): Promise<string> {
    try {
      const result = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: options.contentType,
        }),
      );
      if (!result.UploadId) throw new Error('CreateMultipartUpload 沒有回傳 UploadId');
      return result.UploadId;
    } catch (error) {
      throw this.unavailable(error, 'createMultipartUpload');
    }
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    options: { expiresIn: number },
  ): Promise<PresignedRequest> {
    const url = await getSignedUrl(
      this.presigner,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: options.expiresIn },
    );
    return {
      url,
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
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            // S3 要求 ETag 帶雙引號
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: `"${stripQuotes(part.etag)}"`,
            })),
          },
        }),
      );
    } catch (error) {
      if (error instanceof S3ServiceException && INVALID_PARTS_ERRORS.has(error.name)) {
        throw new AppException('FILE_UPLOAD_INCOMPLETE');
      }
      throw this.unavailable(error, 'completeMultipartUpload');
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
      );
    } catch (error) {
      if (isNotFound(error)) return;
      throw this.unavailable(error, 'abortMultipartUpload');
    }
  }

  async *listMultipartUploads(prefix: string): AsyncIterable<PendingMultipartUpload> {
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      let page;
      try {
        // oxlint-disable-next-line no-await-in-loop -- 下一頁要用這一頁的 marker
        page = await this.client.send(
          new ListMultipartUploadsCommand({
            Bucket: this.bucket,
            Prefix: prefix,
            KeyMarker: keyMarker,
            UploadIdMarker: uploadIdMarker,
          }),
        );
      } catch (error) {
        throw this.unavailable(error, 'listMultipartUploads');
      }
      for (const upload of page.Uploads ?? []) {
        if (!upload.Key || !upload.UploadId) continue;
        yield {
          key: upload.Key,
          uploadId: upload.UploadId,
          initiatedAt: upload.Initiated ?? new Date(0),
        };
      }
      const truncated = page.IsTruncated === true;
      keyMarker = truncated ? page.NextKeyMarker : undefined;
      uploadIdMarker = truncated ? page.NextUploadIdMarker : undefined;
    } while (keyMarker);
  }

  private async createBucketIfMissing(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (error) {
      if (!isNotFound(error)) throw this.unavailable(error, 'headBucket');
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log({ bucket: this.bucket }, '已建立 bucket');
    } catch (error) {
      // 另一個執行個體剛好同時建立
      if (error instanceof S3ServiceException && error.name === 'BucketAlreadyOwnedByYou') return;
      throw this.unavailable(error, 'createBucket');
    }
  }

  private unavailable(error: unknown, operation: string): AppException {
    this.logger.error({ err: error, operation, bucket: this.bucket }, '物件儲存操作失敗');
    return new AppException('FILE_STORAGE_UNAVAILABLE');
  }
}
