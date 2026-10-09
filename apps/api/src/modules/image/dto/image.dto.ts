import { z } from 'zod';

import { ImageSourcesSchema } from '@/core/image';
import { defineSchema } from '@/core/validation';
import { IMAGE_ASSET_STATUSES } from '@/db/schema';

import { IMAGE_FAILURE_REASONS } from '../image.constants';

const UsageIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/)
  .max(100);

const SourceIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][A-Za-z0-9]*$/)
  .max(50);

const Fraction = z.number().min(0).max(1);

/**
 * 裁切的範圍，以 **比例**（0～1，相對於轉正之後的圖）表示（docs/architecture/backend/25-image.md §15.5）：
 * 前端不必知道伺服器把主檔縮成多大。
 */
export const ImageCropSchema = defineSchema(
  'ImageCrop',
  z
    .object({ x: Fraction, y: Fraction, width: Fraction, height: Fraction })
    .refine((crop) => crop.width > 0 && crop.height > 0, { message: 'empty crop' })
    .refine((crop) => crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001, {
      message: 'crop outside image',
    }),
);

/** 一個使用圖片的地方的限制（`GET /images/usages`；後端是唯一的事實來源，D8）。 */
export const ImageUsageSchema = defineSchema(
  'ImageUsage',
  z.object({
    id: z.string(),
    /** 來源原檔的大小上限（位元組）。 */
    maxSize: z.number().int(),
    contentTypes: z.array(z.string()),
    /** 裁切之後的最小尺寸（px）。 */
    minWidth: z.number().int(),
    minHeight: z.number().int(),
    /** 寬 ÷ 高；有值時一定要裁切成這個比例。 */
    aspectRatio: z.number().nullable(),
    /** 具名的尺寸（長邊 px）；`ImageSources.variants` 的名稱。 */
    presets: z.record(z.string(), z.number().int()),
    /** 只允許這些來源；`null` 是全部。 */
    sources: z.array(z.string()).nullable(),
  }),
);

export const ImageUsageListSchema = defineSchema(
  'ImageUsageList',
  z.object({ items: z.array(ImageUsageSchema) }),
);

export const ImageAssetStatusSchema = z.enum(IMAGE_ASSET_STATUSES);
export const ImageFailureReasonSchema = z.enum(IMAGE_FAILURE_REASONS);

/** 主檔（未裁切）的網址：重新裁切、「最近使用」換一個比例時顯示整張圖。 */
export const ImageOriginalSchema = defineSchema(
  'ImageOriginal',
  z.object({
    url: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    expiresAt: z.string(),
  }),
);

/** 自己建立的一張圖片資產（上傳、處理狀態、「最近使用」）。 */
export const ImageAssetSchema = defineSchema(
  'ImageAsset',
  z.object({
    id: z.string().uuid(),
    usage: z.string(),
    status: ImageAssetStatusSchema,
    failureReason: ImageFailureReasonSchema.nullable(),
    /** 原本的名稱（檔名）。 */
    name: z.string(),
    /** `upload`、`file`、`gallery`、`recent`。 */
    source: z.string(),
    /** 主檔（未裁切）的尺寸；還在處理時是 `null`。 */
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    crop: ImageCropSchema.nullable(),
    /** 裁切之後的各尺寸；還在處理時是 `null`。 */
    image: ImageSourcesSchema.nullable(),
    original: ImageOriginalSchema.nullable(),
    /** 已被某個資源使用（頭像等）。 */
    isInUse: z.boolean(),
    createdAt: z.string(),
  }),
);

export const ImageAssetListSchema = defineSchema(
  'ImageAssetList',
  z.object({ items: z.array(ImageAssetSchema) }),
);

export const CreateImageUploadSchema = defineSchema(
  'CreateImageUploadRequest',
  z.object({
    usage: UsageIdSchema,
    /** 顯示用的名稱（檔名；貼上的圖片由前端以時間命名）。 */
    name: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(100),
    size: z.number().int().positive(),
  }),
);

/** 瀏覽器直傳的目標：大小、型別與「只能寫一次」都簽進網址。 */
export const ImageUploadTargetSchema = defineSchema(
  'ImageUploadTarget',
  z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
);

export const ImageUploadSchema = defineSchema(
  'ImageUpload',
  z.object({ asset: ImageAssetSchema, upload: ImageUploadTargetSchema }),
);

export const CompleteImageUploadSchema = defineSchema(
  'CompleteImageUploadRequest',
  z.object({ crop: ImageCropSchema.optional() }),
);

export const CreateImageFromSourceSchema = defineSchema(
  'CreateImageFromSourceRequest',
  z.object({
    usage: UsageIdSchema,
    /** 來源的 id（`file`、`gallery`、`recent`…）；字串契約，不是列舉（docs/architecture/backend/25-image.md §15.2）。 */
    source: SourceIdSchema,
    /** 來源那一筆的 id（檔案 id、圖片資產 id…）。 */
    refId: z.string().trim().min(1).max(200),
    crop: ImageCropSchema.optional(),
  }),
);

export const ListRecentImagesSchema = z.object({ usage: UsageIdSchema });

export type ImageCropDto = z.infer<typeof ImageCropSchema>;
export type ImageUsageDto = z.infer<typeof ImageUsageSchema>;
export type ImageAssetDto = z.infer<typeof ImageAssetSchema>;
export type ImageUploadDto = z.infer<typeof ImageUploadSchema>;
export type CreateImageUploadDto = z.infer<typeof CreateImageUploadSchema>;
export type CompleteImageUploadDto = z.infer<typeof CompleteImageUploadSchema>;
export type CreateImageFromSourceDto = z.infer<typeof CreateImageFromSourceSchema>;
export type ListRecentImagesDto = z.infer<typeof ListRecentImagesSchema>;
