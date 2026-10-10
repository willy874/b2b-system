import { z } from 'zod';

import { SortSchema } from '@/core/http';
import { ImageSourcesSchema } from '@/core/image';
import { defineSchema } from '@/core/validation';
import { GALLERY_ITEM_STATUSES } from '@/db/schema';
import { TagIdsFilterSchema, TagSummarySchema } from '@/modules/tag/dto/tag.dto';

import {
  GALLERY_FAILURE_REASONS,
  GALLERY_FROM_SOURCE_MAX,
  GALLERY_PAGE_SIZE,
  GALLERY_PAGE_SIZE_MAX,
} from '../gallery.constants';
import { GALLERY_SORT_FIELDS } from '../gallery.cursor';

/** 標題：規則同檔名（不能有路徑分隔字元與控制字元，docs/architecture/backend/09-file.md §4）。 */
const TitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // oxlint-disable-next-line no-control-regex -- 擋的就是控制字元
  .refine((value) => !/[\u0000-\u001f\u007f/\\]/.test(value), { message: 'invalid title' });

const DescriptionSchema = z.string().trim().max(1000);

const SourceIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][A-Za-z0-9]*$/)
  .max(50);

export const GalleryItemStatusSchema = z.enum(GALLERY_ITEM_STATUSES);
export const GalleryFailureReasonSchema = z.enum(GALLERY_FAILURE_REASONS);
export const GalleryRotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

/** 方向（由顯示的寬高算）：橫式、直式、正方形（寬高差在 1% 以內）。 */
export const GALLERY_ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;

/** 列表、時間軸、上一張／下一張共用的篩選（§7）。 */
const GalleryFilterShape = {
  /** 標題與說明的部分比對（不分大小寫）。 */
  keyword: z.string().trim().max(100).optional(),
  albumId: z.string().uuid().optional(),
  /** 貼了其中任一個標籤。 */
  tagId: TagIdsFilterSchema,
  /** 拍攝日期（沒有 EXIF 的用加入時間，即 `sortAt`）的範圍，ISO 8601；`takenTo` 不含。 */
  takenFrom: z.iso.datetime({ offset: true }).optional(),
  takenTo: z.iso.datetime({ offset: true }).optional(),
  orientation: z.enum(GALLERY_ORIENTATIONS).optional(),
  uploaderId: z.string().uuid().optional(),
  /** `upload`：自行上傳；`added`：從其他來源加入。 */
  origin: z.enum(['upload', 'added']).optional(),
  /**
   * 選圖用（docs/architecture/backend/25-image.md §15）：只列能當這個用途的圖（型別、大小）；
   * 尺寸太小的照樣列出，由前端依寬高停用。
   */
  imageUsage: z
    .string()
    .trim()
    .regex(/^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/)
    .max(100)
    .optional(),
};

const GallerySortShape = SortSchema(GALLERY_SORT_FIELDS, [{ sort: 'sortAt', order: 'desc' }]).shape;

export const ListGalleryItemsSchema = z.object({
  ...GalleryFilterShape,
  ...GallerySortShape,
  limit: z.coerce.number().int().min(1).max(GALLERY_PAGE_SIZE_MAX).default(GALLERY_PAGE_SIZE),
  /** keyset 分頁的游標（回應的 `nextCursor`）。 */
  cursor: z.string().trim().max(1000).optional(),
  /**
   * 快速捲動（日期捲軸）：第一頁從這個時間開始（遞減時取 `< startAt`、遞增時取 `>= startAt`）。
   * 只適用於依時間排序；帶 `cursor` 時忽略。
   */
  startAt: z.iso.datetime({ offset: true }).optional(),
});

export const GalleryTimelineQuerySchema = z.object({
  ...GalleryFilterShape,
  /** 依哪一個時間分組（同列表的排序）。 */
  field: z.enum(['sortAt', 'createdAt']).default('sortAt'),
});

export const GalleryNeighborsQuerySchema = z.object({ ...GalleryFilterShape, ...GallerySortShape });

/** 一張圖的各尺寸（`ImageSources.variants` 的名稱）：`grid`（`thumb 480w, medium 1280w`）、`medium`、`large`。 */
export const GallerySummarySchema = defineSchema(
  'GalleryItem',
  z.object({
    id: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable(),
    contentType: z.string(),
    size: z.number().int(),
    /** 顯示的尺寸（套用 EXIF 方向與 `displayRotation` 之後）。 */
    width: z.number().int(),
    height: z.number().int(),
    displayRotation: GalleryRotationSchema,
    /** `#rrggbb`：載入前的背景色（資料，以 inline style 套用，D11）。 */
    dominantColor: z.string().nullable(),
    /** BlurHash：載入前的模糊預覽。 */
    placeholder: z.string().nullable(),
    takenAt: z.string().nullable(),
    /** 時間軸用的時間：拍攝時間，沒有時是加入時間。 */
    sortAt: z.string(),
    createdAt: z.string(),
    image: ImageSourcesSchema,
    tags: z.array(TagSummarySchema),
    version: z.number().int(),
  }),
);

export const GalleryItemListSchema = defineSchema(
  'GalleryItemList',
  z.object({
    items: z.array(GallerySummarySchema),
    /** 下一頁的游標；沒有下一頁時是 null。 */
    nextCursor: z.string().nullable(),
    /**
     * 上一頁的游標（`cursor=` 帶回來取排在這一頁之前的一頁）：無限捲動丟掉前面的頁之後往回取。
     * 沒帶游標也沒有 `startAt` 的第一頁、或往前已經取到最前面時是 null。
     */
    prevCursor: z.string().nullable(),
  }),
);

export const GalleryExifSchema = defineSchema(
  'GalleryExif',
  z.object({
    make: z.string().optional(),
    model: z.string().optional(),
    lensMake: z.string().optional(),
    lensModel: z.string().optional(),
    focalLength: z.number().optional(),
    focalLength35mm: z.number().optional(),
    fNumber: z.number().optional(),
    exposureTime: z.number().optional(),
    iso: z.number().optional(),
    flashFired: z.boolean().optional(),
  }),
);

export const GalleryItemDetailSchema = defineSchema(
  'GalleryItemDetail',
  GallerySummarySchema.extend({
    exif: GalleryExifSchema.nullable(),
    /** 原檔的位置資訊已依系統設定移除。 */
    locationStripped: z.boolean(),
    /** `upload` 或加入時的來源（`file`…）與那一筆的名稱（只是文字，不連回來源）。 */
    source: z.string(),
    sourceName: z.string().nullable(),
    uploader: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    albums: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    /** 內容相同（SHA-256）的其他圖片（D7）。 */
    duplicates: z.array(z.object({ id: z.string().uuid(), title: z.string() })),
    /**
     * 原檔（inline）：檢視器放大超過 `large` 時用。瀏覽器顯示不了（TIFF）、或調整過顯示方向（原檔沒有轉）時是 null。
     */
    original: z
      .object({
        url: z.string(),
        width: z.number().int(),
        height: z.number().int(),
        expiresAt: z.string(),
      })
      .nullable(),
    /** 下載（`Content-Disposition: attachment`，帶檔名）：原檔與 `large`。 */
    download: z.object({ original: z.string(), large: z.string() }),
  }),
);

export const GalleryNeighborsSchema = defineSchema(
  'GalleryNeighbors',
  z.object({ previousId: z.string().uuid().nullable(), nextId: z.string().uuid().nullable() }),
);

export const GalleryTimelineSchema = defineSchema(
  'GalleryTimeline',
  z.object({
    /** 分組用的時區（租戶的 `general.defaultTimezone`）。 */
    timeZone: z.string(),
    /** 新到舊；`month` 是 `YYYY-MM`。 */
    months: z.array(z.object({ month: z.string(), count: z.number().int() })),
  }),
);

export const CreateGalleryUploadSchema = defineSchema(
  'CreateGalleryUploadRequest',
  z.object({
    /** 檔名：標題預設是去掉副檔名的檔名。 */
    fileName: z.string().trim().min(1).max(255),
    title: TitleSchema.optional(),
    contentType: z.string().trim().min(1).max(100),
    size: z.number().int().positive(),
    /** 瀏覽器量的尺寸（暫定值）；處理時以實際解碼的為準。 */
    width: z.number().int().positive().max(100_000).optional(),
    height: z.number().int().positive().max(100_000).optional(),
    /** 處理完成後一併加入這個相簿。 */
    albumId: z.string().uuid().optional(),
  }),
);

export const GalleryUploadTargetSchema = defineSchema(
  'GalleryUploadTarget',
  z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
);

/** 自己上傳中的一筆（還沒出現在圖片庫）。 */
export const GalleryUploadItemSchema = defineSchema(
  'GalleryUploadItem',
  z.object({
    id: z.string().uuid(),
    title: z.string(),
    status: GalleryItemStatusSchema,
    failureReason: GalleryFailureReasonSchema.nullable(),
    createdAt: z.string(),
  }),
);

export const GalleryUploadSchema = defineSchema(
  'GalleryUpload',
  z.object({ item: GalleryUploadItemSchema, upload: GalleryUploadTargetSchema }),
);

/** 頁首的「處理中 N 張」與處理失敗的清單（只有自己的）。 */
export const GalleryUploadStatusSchema = defineSchema(
  'GalleryUploadStatus',
  z.object({
    processing: z.number().int(),
    failed: z.array(GalleryUploadItemSchema),
    /** 單檔上限（bytes）：租戶的 feature 參數 `gallery.maxItemSizeMb` 的生效值，前端選檔時先檢查（只是體驗）。 */
    maxItemSize: z.number().int(),
  }),
);

export const CreateGalleryFromSourceSchema = defineSchema(
  'CreateGalleryFromSourceRequest',
  z.object({
    /** 來源的 id（`file`…）；字串契約，圖片庫不知道它代表什麼（D0）。 */
    source: SourceIdSchema,
    refIds: z.array(z.string().trim().min(1).max(200)).min(1).max(GALLERY_FROM_SOURCE_MAX),
    albumId: z.string().uuid().optional(),
  }),
);

export const GALLERY_SKIP_REASONS = [
  'typeNotAllowed',
  'tooLarge',
  'alreadyAdded',
  'notFound',
] as const;

export const GalleryFromSourceResultSchema = defineSchema(
  'GalleryFromSourceResult',
  z.object({
    results: z.array(
      z.object({
        refId: z.string(),
        status: z.enum(['added', 'skipped']),
        itemId: z.string().uuid().nullable(),
        reason: z.enum(GALLERY_SKIP_REASONS).nullable(),
        /** `alreadyAdded` 時是圖片庫裡的那一張。 */
        existingItemId: z.string().uuid().nullable(),
        name: z.string().nullable(),
      }),
    ),
  }),
);

export const UpdateGalleryItemSchema = defineSchema(
  'UpdateGalleryItemRequest',
  z
    .object({
      version: z.number().int().positive(),
      title: TitleSchema.optional(),
      description: DescriptionSchema.nullable().optional(),
      displayRotation: GalleryRotationSchema.optional(),
    })
    .refine(
      (dto) =>
        dto.title !== undefined ||
        dto.description !== undefined ||
        dto.displayRotation !== undefined,
      { message: 'nothing to update' },
    ),
);

export type ListGalleryItemsDto = z.infer<typeof ListGalleryItemsSchema>;
export type GalleryTimelineQueryDto = z.infer<typeof GalleryTimelineQuerySchema>;
export type GalleryNeighborsQueryDto = z.infer<typeof GalleryNeighborsQuerySchema>;
export type GalleryFilterDto = Omit<GalleryNeighborsQueryDto, 'sort'>;
export type GalleryItemDto = z.infer<typeof GallerySummarySchema>;
export type GalleryItemDetailDto = z.infer<typeof GalleryItemDetailSchema>;
export type GalleryItemListDto = z.infer<typeof GalleryItemListSchema>;
export type GalleryNeighborsDto = z.infer<typeof GalleryNeighborsSchema>;
export type GalleryTimelineDto = z.infer<typeof GalleryTimelineSchema>;
export type CreateGalleryUploadDto = z.infer<typeof CreateGalleryUploadSchema>;
export type GalleryUploadDto = z.infer<typeof GalleryUploadSchema>;
export type GalleryUploadItemDto = z.infer<typeof GalleryUploadItemSchema>;
export type GalleryUploadStatusDto = z.infer<typeof GalleryUploadStatusSchema>;
export type CreateGalleryFromSourceDto = z.infer<typeof CreateGalleryFromSourceSchema>;
export type GalleryFromSourceResultDto = z.infer<typeof GalleryFromSourceResultSchema>;
export type UpdateGalleryItemDto = z.infer<typeof UpdateGalleryItemSchema>;
