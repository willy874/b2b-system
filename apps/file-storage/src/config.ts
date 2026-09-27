import { resolve } from 'node:path';

import { z } from 'zod';

import type { Credentials } from '@/auth/sigv4';

/** S3 multipart 除了最後一段之外，每段至少 5 MiB。 */
export const S3_MIN_PART_SIZE = 5 * 1024 * 1024;
/** S3 單次 PutObject 的上限。 */
const S3_MAX_OBJECT_SIZE = 5 * 1024 ** 3;

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  );

/**
 * 環境變數缺少或格式錯誤時啟動失敗，與 apps/api 的 `env.schema.ts` 同一個原則。
 */
const EnvSchema = z.object({
  FILE_STORAGE_HOST: z.string().trim().min(1).default('127.0.0.1'),
  FILE_STORAGE_PORT: z.coerce.number().int().min(0).max(65_535).default(9000),
  /**
   * 掛在反向代理子路徑下時的前綴（例：`/storage`）。代理 **不可** 去掉前綴：
   * SigV4 簽的是瀏覽器看到的完整路徑（docs/architecture/03-file-storage.md §3.1）。
   */
  FILE_STORAGE_BASE_PATH: z
    .string()
    .trim()
    .regex(/^(\/[A-Za-z0-9._~-]+)*$/, '必須是空字串或以 / 開頭、不以 / 結尾的路徑')
    .default(''),
  /** 相對路徑以 `apps/file-storage/` 為基準。 */
  FILE_STORAGE_DATA_DIR: z.string().trim().min(1).default('.data'),
  /** 只影響 HeadBucket / GetBucketLocation 的回報值；簽章接受任何 region。 */
  FILE_STORAGE_REGION: z.string().trim().min(1).default('us-east-1'),
  FILE_STORAGE_ACCESS_KEY_ID: z.string().trim().min(3).max(128),
  FILE_STORAGE_SECRET_ACCESS_KEY: z.string().trim().min(8).max(128),
  /** 允許跨來源存取（presigned URL 直傳 / 下載）的 Origin，逗號分隔；`*` 代表全部。 */
  FILE_STORAGE_ALLOWED_ORIGINS: csv,
  FILE_STORAGE_MAX_OBJECT_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .max(S3_MAX_OBJECT_SIZE)
    .default(S3_MAX_OBJECT_SIZE),
});

export interface FileStorageConfig {
  host: string;
  port: number;
  basePath: string;
  dataDir: string;
  region: string;
  credentials: Credentials;
  allowedOrigins: readonly string[];
  maxObjectSize: number;
  minPartSize: number;
}

/**
 * @param baseDir `FILE_STORAGE_DATA_DIR` 為相對路徑時的基準目錄。
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  baseDir: string = process.cwd(),
): FileStorageConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `file-storage 的環境變數不正確，請對照根目錄 .env.example 補上 FILE_STORAGE_*：\n${z.prettifyError(parsed.error)}`,
    );
  }
  const values = parsed.data;
  return {
    host: values.FILE_STORAGE_HOST,
    port: values.FILE_STORAGE_PORT,
    basePath: values.FILE_STORAGE_BASE_PATH,
    dataDir: resolve(baseDir, values.FILE_STORAGE_DATA_DIR),
    region: values.FILE_STORAGE_REGION,
    credentials: {
      accessKeyId: values.FILE_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: values.FILE_STORAGE_SECRET_ACCESS_KEY,
    },
    allowedOrigins: values.FILE_STORAGE_ALLOWED_ORIGINS,
    maxObjectSize: values.FILE_STORAGE_MAX_OBJECT_SIZE,
    minPartSize: S3_MIN_PART_SIZE,
  };
}
