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
    urlExpiresAt: z.string().nullable(),
    uploader: FileUploaderSchema.nullable(),
    uploadedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
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

export const FileUploadSchema = defineSchema(
  'FileUpload',
  z.object({ file: FileSchema, upload: FileUploadTargetSchema }),
);

export type FileDto = z.infer<typeof FileSchema>;
export type FileUploadDto = z.infer<typeof FileUploadSchema>;
