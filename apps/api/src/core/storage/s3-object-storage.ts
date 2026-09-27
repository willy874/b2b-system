import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { AppException } from '../errors';
import { contentDisposition } from './content-disposition';
import { ObjectStorage } from './object-storage';
import type {
  PresignDownloadOptions,
  PresignedRequest,
  PresignUploadOptions,
  StoredObjectHead,
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
    const url = await getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(options.disposition, options.fileName),
      }),
      { expiresIn: options.expiresIn },
    );
    return {
      url,
      method: 'GET',
      headers: {},
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
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
