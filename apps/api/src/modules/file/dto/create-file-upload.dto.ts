import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { THUMBNAIL_CONTENT_TYPES, THUMBNAIL_MAX_SIZE } from '../file.constants';

/** 顯示用檔名：不可含路徑分隔字元或控制字元（下載時會寫進 Content-Disposition）。 */
export const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // oxlint-disable-next-line no-control-regex -- 就是要排除控制字元
  .regex(/^[^/\\\u0000-\u001f\u007f]+$/, 'must not contain path separators or control characters');

/** `type/subtype`，不含參數（`; charset=…`）；一律轉小寫。 */
export const ContentTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/, 'must be a MIME type');

export const CreateFileUploadSchema = defineSchema(
  'CreateFileUploadRequest',
  z.object({
    name: FileNameSchema,
    contentType: ContentTypeSchema,
    /**
     * 位元組。上限由 `FILE_UPLOAD_MAX_SIZE` 決定，超過回 `FILE_TOO_LARGE`；
     * 超過 `FILE_MULTIPART_THRESHOLD` 時回應的是分塊上傳（`multipart`）而不是單次 PUT（`upload`）。
     */
    size: z.number().int().min(0),
    /** 放進哪個資料夾；不帶或 null 是根目錄。資料夾不存在回 `FILE_FOLDER_NOT_FOUND`。 */
    folderId: z.string().uuid().nullable().optional(),
    /** 瀏覽器產生的縮圖；有帶才發縮圖的直傳網址（`thumbnailUpload`）。 */
    thumbnail: z
      .object({
        contentType: z.enum(THUMBNAIL_CONTENT_TYPES),
        size: z.number().int().min(1).max(THUMBNAIL_MAX_SIZE),
      })
      .optional(),
  }),
);

export type CreateFileUploadDto = z.infer<typeof CreateFileUploadSchema>;

export const CreateFileUploadPartsSchema = defineSchema(
  'CreateFileUploadPartsRequest',
  z.object({
    /** 要取得上傳網址的塊號（1 起算）；一次最多 100 塊，邊傳邊要。 */
    partNumbers: z
      .array(z.number().int().min(1).max(10_000))
      .min(1)
      .max(100)
      .refine((numbers) => new Set(numbers).size === numbers.length, {
        message: 'duplicate part number',
      }),
  }),
);

export type CreateFileUploadPartsDto = z.infer<typeof CreateFileUploadPartsSchema>;

export const CompleteFileUploadSchema = defineSchema(
  'CompleteFileUploadRequest',
  z.object({
    /** 分塊上傳必填：每一塊的塊號與上傳時拿到的 ETag，依塊號遞增排列。單次 PUT 上傳不帶。 */
    parts: z
      .array(
        z.object({
          partNumber: z.number().int().min(1).max(10_000),
          etag: z.string().trim().min(1).max(200),
        }),
      )
      .min(1)
      .max(10_000)
      .optional(),
  }),
);

export type CompleteFileUploadDto = z.infer<typeof CompleteFileUploadSchema>;
