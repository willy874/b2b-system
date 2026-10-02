import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { FILE_FOLDER_KINDS, FILE_STATUSES } from '@/db/schema';

import { ContentTypeSchema, FileNameSchema } from '../dto/create-file-upload.dto';

/**
 * 對外 API（`/v1`）的檔案契約（docs/architecture/06-external-api.md §9.2 D12）：與內部的 DTO 分開定義，
 * 內部改欄位不會改到這裡；v1 之內只能加欄位。schema 名稱一律 `External*`，與內部的區分。
 *
 * 不含內部 DTO 的影像網址（`image`，指向內部 api 的簽章端點）、`capabilities`、`version`。
 */

const PresignedTargetSchema = z.object({
  /** 直傳物件儲存的網址：租戶網域的 `/storage`，整合方的網路要連得到。 */
  url: z.string(),
  method: z.literal('PUT'),
  /** 上傳時要原樣帶上的標頭（例：`Content-Type`，簽章涵蓋它）。 */
  headers: z.record(z.string(), z.string()),
});

export const ExternalFileSchema = defineSchema(
  'ExternalFile',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    contentType: z.string(),
    size: z.number().int(),
    /** `pending`：上傳還沒完成（只有上傳者看得到）；`ready`：可以下載。 */
    status: z.enum(FILE_STATUSES),
    /** null：根目錄。 */
    folderId: z.string().uuid().nullable(),
    /** 開啟用的下載網址（安全的類型 inline，其餘 attachment）；`ready` 才有。 */
    url: z.string().nullable(),
    /** 一律 attachment 的下載網址；`ready` 才有。 */
    downloadUrl: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    /** 上面網址最早的到期時間；過了再取一次檔案資訊就有新的網址。 */
    urlExpiresAt: z.string().nullable(),
    uploader: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
    uploadedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const ExternalFileListSchema = defineSchema(
  'ExternalFileList',
  z.object({
    items: z.array(ExternalFileSchema),
    /** 下一頁的游標；null 表示沒有了。 */
    nextCursor: z.string().nullable(),
  }),
);

export const ListExternalFileSchema = z.object({
  /** 只列這個資料夾 **直接** 包含的檔案；`root` 是根目錄。不帶則列出所有看得到的檔案。 */
  folderId: z.union([z.literal('root'), z.string().uuid()]).optional(),
  /** 檔名的部分比對（不分大小寫）。 */
  keyword: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** 上一頁回應的 `nextCursor`。依建立時間由新到舊。 */
  cursor: z.string().trim().max(1000).optional(),
});

export const ExternalFolderSchema = defineSchema(
  'ExternalFolder',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    /** 上層資料夾；null 是根目錄。上層可能不在列表裡（看得到這一層、看不到上一層）。 */
    parentId: z.string().uuid().nullable(),
    kind: z.enum(FILE_FOLDER_KINDS),
    /** 這把 token 能不能在這裡上傳。 */
    canUpload: z.boolean(),
  }),
);

export const ExternalFolderListSchema = defineSchema(
  'ExternalFolderList',
  z.object({
    /** 看得到內容的資料夾（扁平；以 `parentId` 組成樹）。 */
    items: z.array(ExternalFolderSchema),
    /** 能不能上傳到根目錄。 */
    canUploadToRoot: z.boolean(),
  }),
);

export const ExternalCreateFileUploadSchema = defineSchema(
  'ExternalCreateFileUploadRequest',
  z.object({
    name: FileNameSchema,
    contentType: ContentTypeSchema,
    /** 位元組。超過租戶的上限回 `FILE_TOO_LARGE`；超過分塊門檻時回應的是 `multipart` 而不是 `upload`。 */
    size: z.number().int().min(0),
    /** 不帶或 null 是根目錄。 */
    folderId: z.string().uuid().nullable().optional(),
  }),
);

export const ExternalFileUploadSchema = defineSchema(
  'ExternalFileUpload',
  z.object({
    file: ExternalFileSchema,
    /** 單次上傳：PUT 整個檔案到這個網址，再呼叫 complete。 */
    upload: PresignedTargetSchema.extend({ expiresAt: z.string() }).nullable(),
    /** 分塊上傳：以 parts 取得每一塊的網址，各自 PUT，記下回應的 `ETag`，再以 complete 帶上。 */
    multipart: z.object({ partSize: z.number().int(), partCount: z.number().int() }).nullable(),
  }),
);

export const ExternalCreateFileUploadPartsSchema = defineSchema(
  'ExternalCreateFileUploadPartsRequest',
  z.object({
    partNumbers: z
      .array(z.number().int().min(1).max(10_000))
      .min(1)
      .max(100)
      .refine((numbers) => new Set(numbers).size === numbers.length, {
        message: 'duplicate part numbers',
      }),
  }),
);

export const ExternalFileUploadPartsSchema = defineSchema(
  'ExternalFileUploadParts',
  z.object({
    parts: z.array(PresignedTargetSchema.extend({ partNumber: z.number().int() })),
    expiresAt: z.string(),
  }),
);

export const ExternalCompleteFileUploadSchema = defineSchema(
  'ExternalCompleteFileUploadRequest',
  z.object({
    /** 分塊上傳必填：每一塊的編號與 PUT 回應的 `ETag`。單次上傳不帶。 */
    parts: z
      .array(
        z.object({
          partNumber: z.number().int().min(1).max(10_000),
          etag: z.string().min(1).max(200),
        }),
      )
      .min(1)
      .max(10_000)
      .optional(),
  }),
);

export type ExternalFileDto = z.infer<typeof ExternalFileSchema>;
export type ExternalFileListDto = z.infer<typeof ExternalFileListSchema>;
export type ListExternalFileDto = z.infer<typeof ListExternalFileSchema>;
export type ExternalFolderListDto = z.infer<typeof ExternalFolderListSchema>;
export type ExternalCreateFileUploadDto = z.infer<typeof ExternalCreateFileUploadSchema>;
export type ExternalFileUploadDto = z.infer<typeof ExternalFileUploadSchema>;
export type ExternalCreateFileUploadPartsDto = z.infer<typeof ExternalCreateFileUploadPartsSchema>;
export type ExternalFileUploadPartsDto = z.infer<typeof ExternalFileUploadPartsSchema>;
export type ExternalCompleteFileUploadDto = z.infer<typeof ExternalCompleteFileUploadSchema>;
