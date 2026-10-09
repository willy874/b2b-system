import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

/**
 * seed 腳本寫物件儲存用的最小介面：不經過 Nest DI（`core/storage` 的 `S3ObjectStorage` 要租戶脈絡與 ConfigService）。
 * 連線設定與 api 相同（`FILE_STORAGE_*`），bucket 是目標租戶的（docs/architecture/05-tenancy.md §10.2 D16）。
 */
export interface SeedStorage {
  readonly bucket: string;
  /** 寫入一個物件；回傳 ETag（去掉引號，與 `files.etag` 的格式相同）。 */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  close(): void;
}

class S3SeedStorage implements SeedStorage {
  constructor(
    private readonly client: S3Client,
    readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    const result = await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return (result.ETag ?? '').replaceAll('"', '');
  }

  close(): void {
    this.client.destroy();
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound')
  );
}

/**
 * 連上物件儲存並確認 bucket（不存在就建立，與 api 第一次用到時相同）。
 * 連不上時回 undefined：圖片與檔案的假資料整段略過，其他假資料照常寫入；之後啟動 file-storage 再重跑就會補上。
 */
export async function connectSeedStorage(
  bucket: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SeedStorage | undefined> {
  const endpoint = env.FILE_STORAGE_ENDPOINT || 'http://127.0.0.1:9000/storage';
  const client = new S3Client({
    region: env.FILE_STORAGE_REGION || 'us-east-1',
    endpoint,
    // apps/file-storage 只支援 path-style
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.FILE_STORAGE_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.FILE_STORAGE_SECRET_ACCESS_KEY ?? '',
    },
    // 與 api 相同：只在 API 要求時才算 checksum（apps/file-storage 不認得 SDK 預設加上的 CRC32 標頭）
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    return new S3SeedStorage(client, bucket);
  } catch (error) {
    client.destroy();
    console.warn(
      `連不上物件儲存（${endpoint}，bucket ${bucket}）：略過圖片庫、檔案與頭像的假資料。` +
        `先啟動 file-storage（pnpm dev 或 pnpm dev:storage）再重跑 db:seed:dev 就會補上。原因：${(error as Error).message}`,
    );
    return undefined;
  }
}
