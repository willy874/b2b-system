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
  ListBucketsCommand,
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
// 直接取 env.schema：從 `../config` 取值會載入 config.module（`ConfigModule.forRoot` 在載入時就驗證並快取環境變數）
import { TENANT_ORIGIN_PLACEHOLDER } from '../config/env.schema';
import { AppException } from '../errors';
import { currentTenant, requireTenant, TenantDirectory } from '../tenant';
import { contentDisposition } from './content-disposition';
import { ObjectStorage, stableSigningDate } from './object-storage';
import type {
  CreateMultipartUploadOptions,
  ListedObject,
  PendingMultipartUpload,
  PresignDownloadOptions,
  PresignedRequest,
  PresignUploadOptions,
  PresignUploadPartOptions,
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
 *
 * **每個租戶一個 bucket**（docs/architecture/05-tenancy.md §10.2 D16）：每個操作都用目前租戶的 bucket
 * （`TenantContext.storageBucket`），沒有租戶脈絡時拋 `TENANT_NOT_FOUND`，不會退回任何共用的 bucket。
 * 業務模組的 key 不必帶租戶；檔案維護的對帳只列得到自己租戶的物件。
 */
@Injectable()
export class S3ObjectStorage
  extends ObjectStorage
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(S3ObjectStorage.name);
  private readonly isTest: boolean;
  /** api 自己發請求用（容器內網位址）。 */
  private readonly client: S3Client;
  /**
   * 只用來簽 presigned URL（瀏覽器看到的位址）。簽章包含 host 與路徑，所以不能拿內網的 client 簽完再換網址。
   * 每個租戶在自己的網域：endpoint 含 `{tenantOrigin}` 時依目前租戶換成它的 origin，每個 endpoint 一個 client。
   */
  private readonly presigners = new Map<string, S3Client>();
  private readonly publicEndpoint: string;
  private readonly appOrigin: URL;
  private readonly presignerConfig: S3ClientConfig;
  /** bucket → 確認（或建立）中的 Promise；失敗時移除，下一次再試。 */
  private readonly bucketsReady = new Map<string, Promise<void>>();

  constructor(
    config: ConfigService<Env, true>,
    private readonly directory: TenantDirectory,
  ) {
    super();
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
    this.presignerConfig = common;
    this.publicEndpoint = config.get('FILE_STORAGE_PUBLIC_ENDPOINT', { infer: true });
    this.appOrigin = new URL(config.get('APP_PUBLIC_URL', { infer: true }));
  }

  /** 目前租戶的 presigner（瀏覽器看到的 endpoint）；沒有租戶時（平台）用 `APP_PUBLIC_URL` 的 origin。 */
  private async presigner(): Promise<S3Client> {
    let endpoint = this.publicEndpoint;
    if (endpoint.includes(TENANT_ORIGIN_PLACEHOLDER)) {
      const tenant = currentTenant();
      const origin = tenant
        ? `${this.appOrigin.protocol}//${await this.directory.requirePrimaryDomain(tenant.id)}`
        : this.appOrigin.origin;
      endpoint = endpoint.replace(TENANT_ORIGIN_PLACEHOLDER, origin);
    }
    let client = this.presigners.get(endpoint);
    if (!client) {
      client = new S3Client({ ...this.presignerConfig, endpoint });
      this.presigners.set(endpoint, client);
    }
    return client;
  }

  onApplicationBootstrap(): void {
    // 儲存服務還沒起來不該擋住整個 api（RBAC 與檔案無關）；第一次用到檔案時會再試
    if (this.isTest) return;
    this.ensureTenantBuckets().catch((error: unknown) => {
      this.logger.warn({ err: error }, '啟動時無法確認 bucket，第一次存取檔案時會重試');
    });
  }

  onApplicationShutdown(): void {
    this.client.destroy();
    for (const presigner of this.presigners.values()) presigner.destroy();
    this.presigners.clear();
  }

  /** 確認目前租戶的 bucket 存在，不存在就建立。 */
  ensureBucket(): Promise<void> {
    return this.ensure(this.bucket());
  }

  /**
   * 健康檢查：儲存服務連得上（`ListBuckets`）。不看任何一個租戶的 bucket——健康檢查沒有租戶，
   * 各租戶的 bucket 在第一次用到時確認。
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.send(new ListBucketsCommand({}));
      return true;
    } catch {
      return false;
    }
  }

  /** 目前租戶的 bucket；沒有租戶脈絡時拋 `TENANT_NOT_FOUND`。 */
  private bucket(): string {
    return requireTenant().storageBucket;
  }

  private ensure(bucket: string): Promise<void> {
    let ready = this.bucketsReady.get(bucket);
    if (!ready) {
      ready = this.createBucketIfMissing(bucket).catch((error: unknown) => {
        this.bucketsReady.delete(bucket);
        throw error;
      });
      this.bucketsReady.set(bucket, ready);
    }
    return ready;
  }

  /** 啟動時先確認每個 `active` 租戶的 bucket（檔案維護的對帳一開始就要列得到）。 */
  private async ensureTenantBuckets(): Promise<void> {
    const tenants = await this.directory.listActive();
    await Promise.all(tenants.map((tenant) => this.ensure(tenant.storageBucket)));
  }

  async head(key: string): Promise<StoredObjectHead | undefined> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket(), Key: key }),
      );
      return {
        size: result.ContentLength ?? 0,
        etag: stripQuotes(result.ETag),
        contentType: result.ContentType,
        ...(result.ContentEncoding ? { contentEncoding: result.ContentEncoding } : {}),
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw this.unavailable(error, 'head');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
    } catch (error) {
      if (isNotFound(error)) return;
      throw this.unavailable(error, 'delete');
    }
  }

  async getObject(key: string): Promise<Readable | undefined> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket(), Key: key }),
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
          Bucket: this.bucket(),
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
            Bucket: this.bucket(),
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
      await this.presigner(),
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        ContentType: options.contentType,
        ContentLength: options.contentLength,
        IfNoneMatch: '*',
      }),
      // - Content-Type：瀏覽器換了型別就上傳失敗，存下來的型別一定是登記的那個；
      // - Content-Length：只能傳登記的大小，檔案上限與容量擋得住（大小不同 → 403 SignatureDoesNotMatch）；
      // - If-None-Match: *：只能寫一次，complete 之後到網址到期前不能覆寫內容（→ 412 PreconditionFailed）。
      //   complete 發現大小不符時會先刪物件，用同一個網址重傳仍然可以。
      //   S3 從 2024 年起支援條件寫入；換用其他相容服務時要確認（docs/architecture/backend/09-file.md §5）
      {
        expiresIn: options.expiresIn,
        signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
      },
    );
    return {
      url,
      method: 'PUT',
      // Content-Length 由瀏覽器依 body 自動帶（XHR 不能自己設），這裡只列呼叫端要原樣帶上的
      headers: { 'Content-Type': options.contentType, 'If-None-Match': '*' },
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
  }

  async presignDownload(key: string, options: PresignDownloadOptions): Promise<PresignedRequest> {
    const signingDate = stableSigningDate(Date.now(), options.expiresIn);
    const expiresAt = new Date(signingDate.getTime() + options.expiresIn * 1000);
    const url = await getSignedUrl(
      await this.presigner(),
      new GetObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        ResponseContentDisposition: contentDisposition(options.disposition, options.fileName),
        ResponseContentType: options.contentType,
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
          Bucket: this.bucket(),
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
    options: PresignUploadPartOptions,
  ): Promise<PresignedRequest> {
    const url = await getSignedUrl(
      await this.presigner(),
      new UploadPartCommand({
        Bucket: this.bucket(),
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        ContentLength: options.contentLength,
      }),
      // 這一塊只能是切法算出來的大小；UploadPart 不支援 If-None-Match（uploadId 組合後就失效，不能再覆寫）
      { expiresIn: options.expiresIn, signableHeaders: new Set(['content-length']) },
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
          Bucket: this.bucket(),
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
        new AbortMultipartUploadCommand({ Bucket: this.bucket(), Key: key, UploadId: uploadId }),
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
            Bucket: this.bucket(),
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

  private async createBucketIfMissing(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      return;
    } catch (error) {
      if (!isNotFound(error)) throw this.unavailable(error, 'headBucket', bucket);
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      this.logger.log({ bucket }, '已建立 bucket');
    } catch (error) {
      // 另一個執行個體剛好同時建立
      if (error instanceof S3ServiceException && error.name === 'BucketAlreadyOwnedByYou') return;
      throw this.unavailable(error, 'createBucket', bucket);
    }
  }

  private unavailable(
    error: unknown,
    operation: string,
    bucket = currentTenant()?.storageBucket,
  ): AppException {
    // 已經是業務錯誤（例：沒有租戶脈絡的 TENANT_NOT_FOUND）：不是儲存服務故障，原樣拋出
    if (error instanceof AppException) return error;
    this.logger.error({ err: error, operation, bucket }, '物件儲存操作失敗');
    return new AppException('FILE_STORAGE_UNAVAILABLE');
  }
}
