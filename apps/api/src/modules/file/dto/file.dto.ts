import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { FILE_STATUSES } from '@/db/schema';

export const FileStatusSchema = z.enum(FILE_STATUSES);

export const FileUploaderSchema = defineSchema(
  'FileUploader',
  z.object({ id: z.string().uuid(), displayName: z.string() }),
);

/**
 * 前端看到的檔案。不暴露物件儲存的 key 或 bucket——只有 id 與可以直接使用的網址。
 */
export const FileSchema = defineSchema(
  'StoredFile',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    contentType: z.string(),
    size: z.number().int(),
    status: FileStatusSchema,
    /** 直接顯示用（`<img src>`、`<video src>`）；`pending` 時為 null。有效期限見 `urlExpiresAt`。 */
    url: z.string().nullable(),
    /** 觸發瀏覽器下載、並以 `name` 為檔名；`pending` 時為 null。 */
    downloadUrl: z.string().nullable(),
    /** 上傳時一併產生的縮圖（列表的圖示預覽用）；沒有縮圖時為 null，改用 `url` 或類型圖示。 */
    thumbnailUrl: z.string().nullable(),
    /** 三個網址中最早失效的時間；同一個時間窗內網址不變，瀏覽器快取可以命中。 */
    urlExpiresAt: z.string().nullable(),
    /** 樂觀鎖版本：改名時帶上，版本不同回 `FILE_VERSION_CONFLICT`。 */
    version: z.number().int(),
    uploader: FileUploaderSchema.nullable(),
    uploadedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

/** OpenAPI 名稱避開瀏覽器內建的 `FileList`（同 `StoredFile` 避開 `File`）。 */
export const FileListSchema = defineSchema(
  'FileListPage',
  z.object({
    items: z.array(FileSchema),
    pagination: z.object({
      offset: z.number().int(),
      limit: z.number().int(),
      total: z.number().int(),
    }),
    /** keyset 分頁：下一頁的游標（`GET /files?cursor=`）；沒有下一頁時為 null。 */
    nextCursor: z.string().nullable(),
  }),
);

/** 瀏覽器要照著發出的上傳請求（presigned PUT）。 */
export const FileUploadTargetSchema = defineSchema(
  'FileUploadTarget',
  z.object({
    url: z.string(),
    method: z.literal('PUT'),
    /** 必須原樣帶上（已納入簽章）。 */
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
);

/** 分塊上傳的切法：前端依此切塊，再以 `POST /files/:id/parts` 取得各塊的上傳網址。 */
export const FileMultipartUploadSchema = defineSchema(
  'FileMultipartUpload',
  z.object({
    /** 每塊的位元組數；最後一塊可以比較小。 */
    partSize: z.number().int(),
    partCount: z.number().int(),
  }),
);

export const FileUploadSchema = defineSchema(
  'FileUpload',
  z.object({
    file: FileSchema,
    /** 單次 PUT 上傳；分塊上傳時為 null。 */
    upload: FileUploadTargetSchema.nullable(),
    /** 分塊上傳；單次 PUT 上傳時為 null。 */
    multipart: FileMultipartUploadSchema.nullable(),
    /** 縮圖的直傳網址；登記時沒帶 `thumbnail` 時為 null。 */
    thumbnailUpload: FileUploadTargetSchema.nullable(),
  }),
);

export const FileUploadPartSchema = defineSchema(
  'FileUploadPart',
  z.object({
    partNumber: z.number().int(),
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
  }),
);

export const FileUploadPartsSchema = defineSchema(
  'FileUploadParts',
  z.object({ parts: z.array(FileUploadPartSchema), expiresAt: z.string() }),
);

/** 前端上傳前的檢查與切塊策略；數值來自環境變數。 */
export const FileUploadPolicySchema = defineSchema(
  'FileUploadPolicy',
  z.object({
    maxSize: z.number().int(),
    multipartThreshold: z.number().int(),
    partSize: z.number().int(),
    thumbnailMaxSize: z.number().int(),
    thumbnailContentTypes: z.array(z.string()),
  }),
);

export type FileDto = z.infer<typeof FileSchema>;
export type FileListDto = z.infer<typeof FileListSchema>;
export type FileUploadDto = z.infer<typeof FileUploadSchema>;
export type FileUploadPartsDto = z.infer<typeof FileUploadPartsSchema>;
export type FileUploadPolicyDto = z.infer<typeof FileUploadPolicySchema>;
