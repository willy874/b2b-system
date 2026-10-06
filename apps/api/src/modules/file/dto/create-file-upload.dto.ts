import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import {
  MAX_PART_COUNT,
  MAX_PARTS_PER_REQUEST,
  THUMBNAIL_CONTENT_TYPES,
  THUMBNAIL_MAX_SIZE,
} from '../file.constants';

/**
 * 檔名與資料夾名稱不可含的字元（字元類別的內容；docs/architecture/backend/09-file.md §4、§4.2）：
 * - 路徑分隔字元 `/`、`\`；
 * - Unicode 的控制字元 `Cc`：C0、DEL、C1（U+0000–U+001F、U+007F–U+009F）；
 * - 雙向文字控制（U+061C、U+200E、U+200F、U+202A–U+202E、U+2066–U+2069）：`invoice` ＋ U+202E ＋ `fdp.exe`
 *   在列表、稽核、審批頁都會顯示成 `invoiceexe.pdf`；
 * - 零寬與分隔（U+200B、U+2028、U+2029、U+FEFF）：做得出「看起來同名」的兩個資料夾。
 *
 * 保留 U+200C／U+200D（ZWNJ／ZWJ）：有些文字與以 ZWJ 串起來的 emoji 需要它們。
 * 以明確的 BMP 範圍寫、不用 `\p{Cc}`：pattern 會進 OpenAPI，SDK 以不帶 `u` flag 的 `new RegExp()` 重建，
 * `\p{…}` 在那裡會變成字面的 `p{…}`。
 */
const FORBIDDEN_NAME_CHARS = String.raw`/\\\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff`;

/** 不含任何 `FORBIDDEN_NAME_CHARS` 的名稱。 */
const FILE_NAME_PATTERN = new RegExp(`^[^${FORBIDDEN_NAME_CHARS}]+$`);

/** 一段連續的 `FORBIDDEN_NAME_CHARS`：把外來的字串（例：顯示名稱）清理成合法的名稱時用。 */
export const FORBIDDEN_NAME_CHARS_RUN = new RegExp(`[${FORBIDDEN_NAME_CHARS}]+`, 'g');

/** 顯示用檔名：不可含路徑分隔字元、控制字元、雙向文字控制與零寬字元（下載時會寫進 Content-Disposition）。 */
export const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(
    FILE_NAME_PATTERN,
    'must not contain path separators, control, bidirectional or zero-width characters',
  );

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
    /** 要取得上傳網址的塊號（1 起算）；一次最多 `MAX_PARTS_PER_REQUEST`（100）塊，邊傳邊要。 */
    partNumbers: z
      .array(z.number().int().min(1).max(MAX_PART_COUNT))
      .min(1)
      .max(MAX_PARTS_PER_REQUEST)
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
          partNumber: z.number().int().min(1).max(MAX_PART_COUNT),
          etag: z.string().trim().min(1).max(200),
        }),
      )
      .min(1)
      .max(MAX_PART_COUNT)
      .optional(),
  }),
);

export type CompleteFileUploadDto = z.infer<typeof CompleteFileUploadSchema>;
