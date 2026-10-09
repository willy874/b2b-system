// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  GalleryAlbumControllerAddItemsInput,
  GalleryAlbumControllerAddItemsResult,
  GalleryAlbumControllerCreateInput,
  GalleryAlbumControllerCreateResult,
  GalleryAlbumControllerFindOneInput,
  GalleryAlbumControllerFindOneResult,
  GalleryAlbumControllerListResult,
  GalleryAlbumControllerRemoveInput,
  GalleryAlbumControllerRemoveItemsInput,
  GalleryAlbumControllerRemoveItemsResult,
  GalleryAlbumControllerRemoveResult,
  GalleryAlbumControllerRestoreInput,
  GalleryAlbumControllerRestoreResult,
  GalleryAlbumControllerUpdateInput,
  GalleryAlbumControllerUpdateResult,
  GalleryItemControllerClearFailedResult,
  GalleryItemControllerCompleteUploadInput,
  GalleryItemControllerCompleteUploadResult,
  GalleryItemControllerCreateFromSourceInput,
  GalleryItemControllerCreateFromSourceResult,
  GalleryItemControllerCreateUploadInput,
  GalleryItemControllerCreateUploadResult,
  GalleryItemControllerFindOneInput,
  GalleryItemControllerFindOneResult,
  GalleryItemControllerListResult,
  GalleryItemControllerNeighborsInput,
  GalleryItemControllerNeighborsResult,
  GalleryItemControllerRemoveInput,
  GalleryItemControllerRemoveResult,
  GalleryItemControllerRestoreInput,
  GalleryItemControllerRestoreResult,
  GalleryItemControllerTimelineResult,
  GalleryItemControllerUpdateInput,
  GalleryItemControllerUpdateResult,
  GalleryItemControllerUploadsResult,
} from '../../endpoints/gallery';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CreateGalleryAlbumRequestSchema,
  CreateGalleryFromSourceRequestSchema,
  CreateGalleryUploadRequestSchema,
  GalleryAlbumItemsRequestSchema,
  GalleryAlbumItemsResultSchema,
  GalleryAlbumListSchema,
  GalleryAlbumSchema,
  GalleryFromSourceResultSchema,
  GalleryItemDetailSchema,
  GalleryItemListSchema,
  GalleryNeighborsSchema,
  GalleryTimelineSchema,
  GalleryUploadItemSchema,
  GalleryUploadSchema,
  GalleryUploadStatusSchema,
  UpdateGalleryAlbumRequestSchema,
  UpdateGalleryItemRequestSchema,
} from '../components';

// GET /gallery/items

export const GalleryItemControllerListSchemas = {
  responses: {
    200: z.object({
      data: GalleryItemListSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerListOperation: OperationDefinition = {
  id: 'GalleryItemController_list',
  method: 'GET',
  path: '/gallery/items',
  responseTypes: { 200: 'json' },
  schemas: GalleryItemControllerListSchemas,
};

/** 圖片（keyset 分頁；篩選：關鍵字、相簿、標籤、日期、方向、上傳者、來源） */
export function galleryItemControllerList(
  options?: RequestOptions,
): Promise<GalleryItemControllerListResult> {
  return request<GalleryItemControllerListResult>(galleryItemControllerListOperation, {}, options);
}

// POST /gallery/items

export const GalleryItemControllerCreateUploadSchemas = {
  body: CreateGalleryUploadRequestSchema,
  responses: {
    201: z.object({
      data: GalleryUploadSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerCreateUploadOperation: OperationDefinition = {
  id: 'GalleryItemController_createUpload',
  method: 'POST',
  path: '/gallery/items',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: GalleryItemControllerCreateUploadSchemas,
};

/** 登記上傳並取得直傳網址（完成後呼叫 complete） */
export function galleryItemControllerCreateUpload(
  input: GalleryItemControllerCreateUploadInput,
  options?: RequestOptions,
): Promise<GalleryItemControllerCreateUploadResult> {
  return request<GalleryItemControllerCreateUploadResult>(
    galleryItemControllerCreateUploadOperation,
    input,
    options,
  );
}

// GET /gallery/items/timeline

export const GalleryItemControllerTimelineSchemas = {
  responses: {
    200: z.object({
      data: GalleryTimelineSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerTimelineOperation: OperationDefinition = {
  id: 'GalleryItemController_timeline',
  method: 'GET',
  path: '/gallery/items/timeline',
  responseTypes: { 200: 'json' },
  schemas: GalleryItemControllerTimelineSchemas,
};

/** 每個月的張數（日期捲軸） */
export function galleryItemControllerTimeline(
  options?: RequestOptions,
): Promise<GalleryItemControllerTimelineResult> {
  return request<GalleryItemControllerTimelineResult>(
    galleryItemControllerTimelineOperation,
    {},
    options,
  );
}

// GET /gallery/items/uploads

export const GalleryItemControllerUploadsSchemas = {
  responses: {
    200: z.object({
      data: GalleryUploadStatusSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerUploadsOperation: OperationDefinition = {
  id: 'GalleryItemController_uploads',
  method: 'GET',
  path: '/gallery/items/uploads',
  responseTypes: { 200: 'json' },
  schemas: GalleryItemControllerUploadsSchemas,
};

/** 自己上傳中與處理失敗的圖片 */
export function galleryItemControllerUploads(
  options?: RequestOptions,
): Promise<GalleryItemControllerUploadsResult> {
  return request<GalleryItemControllerUploadsResult>(
    galleryItemControllerUploadsOperation,
    {},
    options,
  );
}

// DELETE /gallery/items/uploads/failed

export const GalleryItemControllerClearFailedSchemas = {} satisfies OperationSchemas;

const galleryItemControllerClearFailedOperation: OperationDefinition = {
  id: 'GalleryItemController_clearFailed',
  method: 'DELETE',
  path: '/gallery/items/uploads/failed',
  responseTypes: { 204: 'none' },
  schemas: GalleryItemControllerClearFailedSchemas,
};

/** 清掉自己處理失敗的紀錄 */
export function galleryItemControllerClearFailed(
  options?: RequestOptions,
): Promise<GalleryItemControllerClearFailedResult> {
  return request<GalleryItemControllerClearFailedResult>(
    galleryItemControllerClearFailedOperation,
    {},
    options,
  );
}

// POST /gallery/items/from-source

export const GalleryItemControllerCreateFromSourceSchemas = {
  body: CreateGalleryFromSourceRequestSchema,
  responses: {
    200: z.object({
      data: GalleryFromSourceResultSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerCreateFromSourceOperation: OperationDefinition = {
  id: 'GalleryItemController_createFromSource',
  method: 'POST',
  path: '/gallery/items/from-source',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: GalleryItemControllerCreateFromSourceSchemas,
};

/** 從其他來源（檔案管理…）複製加入；逐筆回報加入或略過的原因 */
export function galleryItemControllerCreateFromSource(
  input: GalleryItemControllerCreateFromSourceInput,
  options?: RequestOptions,
): Promise<GalleryItemControllerCreateFromSourceResult> {
  return request<GalleryItemControllerCreateFromSourceResult>(
    galleryItemControllerCreateFromSourceOperation,
    input,
    options,
  );
}

// POST /gallery/items/{id}/complete

export const GalleryItemControllerCompleteUploadSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: GalleryUploadItemSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerCompleteUploadOperation: OperationDefinition = {
  id: 'GalleryItemController_completeUpload',
  method: 'POST',
  path: '/gallery/items/{id}/complete',
  responseTypes: { 200: 'json' },
  schemas: GalleryItemControllerCompleteUploadSchemas,
};

/** 確認直傳完成並排入處理 */
export function galleryItemControllerCompleteUpload(
  input: GalleryItemControllerCompleteUploadInput,
  options?: RequestOptions,
): Promise<GalleryItemControllerCompleteUploadResult> {
  return request<GalleryItemControllerCompleteUploadResult>(
    galleryItemControllerCompleteUploadOperation,
    input,
    options,
  );
}

// GET /gallery/items/{id}

export const GalleryItemControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: GalleryItemDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerFindOneOperation: OperationDefinition = {
  id: 'GalleryItemController_findOne',
  method: 'GET',
  path: '/gallery/items/{id}',
  responseTypes: { 200: 'json' },
  schemas: GalleryItemControllerFindOneSchemas,
};

/** 一張圖片的詳情（EXIF、相簿、重複、原檔與下載的網址） */
export function galleryItemControllerFindOne(
  input: GalleryItemControllerFindOneInput,
  options?: RequestOptions,
): Promise<GalleryItemControllerFindOneResult> {
  return request<GalleryItemControllerFindOneResult>(
    galleryItemControllerFindOneOperation,
    input,
    options,
  );
}

// DELETE /gallery/items/{id}

export const GalleryItemControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const galleryItemControllerRemoveOperation: OperationDefinition = {
  id: 'GalleryItemController_remove',
  method: 'DELETE',
  path: '/gallery/items/{id}',
  responseTypes: { 204: 'none' },
  schemas: GalleryItemControllerRemoveSchemas,
};

/** 刪除（移到回收桶） */
export function galleryItemControllerRemove(
  input: GalleryItemControllerRemoveInput,
  options?: RequestOptions,
): Promise<GalleryItemControllerRemoveResult> {
  return request<GalleryItemControllerRemoveResult>(
    galleryItemControllerRemoveOperation,
    input,
    options,
  );
}

// PATCH /gallery/items/{id}

export const GalleryItemControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateGalleryItemRequestSchema,
  responses: {
    200: z.object({
      data: GalleryItemDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerUpdateOperation: OperationDefinition = {
  id: 'GalleryItemController_update',
  method: 'PATCH',
  path: '/gallery/items/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: GalleryItemControllerUpdateSchemas,
};

/** 編輯標題、說明、顯示方向（樂觀鎖） */
export function galleryItemControllerUpdate(
  input: GalleryItemControllerUpdateInput,
  options?: RequestOptions,
): Promise<GalleryItemControllerUpdateResult> {
  return request<GalleryItemControllerUpdateResult>(
    galleryItemControllerUpdateOperation,
    input,
    options,
  );
}

// GET /gallery/items/{id}/neighbors

export const GalleryItemControllerNeighborsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: GalleryNeighborsSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerNeighborsOperation: OperationDefinition = {
  id: 'GalleryItemController_neighbors',
  method: 'GET',
  path: '/gallery/items/{id}/neighbors',
  responseTypes: { 200: 'json' },
  schemas: GalleryItemControllerNeighborsSchemas,
};

/** 同一個篩選與排序之下的前一張與後一張 */
export function galleryItemControllerNeighbors(
  input: GalleryItemControllerNeighborsInput,
  options?: RequestOptions,
): Promise<GalleryItemControllerNeighborsResult> {
  return request<GalleryItemControllerNeighborsResult>(
    galleryItemControllerNeighborsOperation,
    input,
    options,
  );
}

// POST /gallery/items/{id}/restore

export const GalleryItemControllerRestoreSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: GalleryItemDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryItemControllerRestoreOperation: OperationDefinition = {
  id: 'GalleryItemController_restore',
  method: 'POST',
  path: '/gallery/items/{id}/restore',
  responseTypes: { 200: 'json' },
  schemas: GalleryItemControllerRestoreSchemas,
};

/** 還原刪除的圖片（相簿的關聯一併恢復） */
export function galleryItemControllerRestore(
  input: GalleryItemControllerRestoreInput,
  options?: RequestOptions,
): Promise<GalleryItemControllerRestoreResult> {
  return request<GalleryItemControllerRestoreResult>(
    galleryItemControllerRestoreOperation,
    input,
    options,
  );
}

// GET /gallery/albums

export const GalleryAlbumControllerListSchemas = {
  responses: {
    200: z.object({
      data: GalleryAlbumListSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryAlbumControllerListOperation: OperationDefinition = {
  id: 'GalleryAlbumController_list',
  method: 'GET',
  path: '/gallery/albums',
  responseTypes: { 200: 'json' },
  schemas: GalleryAlbumControllerListSchemas,
};

/** 相簿（封面、名稱、張數） */
export function galleryAlbumControllerList(
  options?: RequestOptions,
): Promise<GalleryAlbumControllerListResult> {
  return request<GalleryAlbumControllerListResult>(
    galleryAlbumControllerListOperation,
    {},
    options,
  );
}

// POST /gallery/albums

export const GalleryAlbumControllerCreateSchemas = {
  body: CreateGalleryAlbumRequestSchema,
  responses: {
    201: z.object({
      data: GalleryAlbumSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryAlbumControllerCreateOperation: OperationDefinition = {
  id: 'GalleryAlbumController_create',
  method: 'POST',
  path: '/gallery/albums',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: GalleryAlbumControllerCreateSchemas,
};

export function galleryAlbumControllerCreate(
  input: GalleryAlbumControllerCreateInput,
  options?: RequestOptions,
): Promise<GalleryAlbumControllerCreateResult> {
  return request<GalleryAlbumControllerCreateResult>(
    galleryAlbumControllerCreateOperation,
    input,
    options,
  );
}

// GET /gallery/albums/{id}

export const GalleryAlbumControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: GalleryAlbumSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryAlbumControllerFindOneOperation: OperationDefinition = {
  id: 'GalleryAlbumController_findOne',
  method: 'GET',
  path: '/gallery/albums/{id}',
  responseTypes: { 200: 'json' },
  schemas: GalleryAlbumControllerFindOneSchemas,
};

export function galleryAlbumControllerFindOne(
  input: GalleryAlbumControllerFindOneInput,
  options?: RequestOptions,
): Promise<GalleryAlbumControllerFindOneResult> {
  return request<GalleryAlbumControllerFindOneResult>(
    galleryAlbumControllerFindOneOperation,
    input,
    options,
  );
}

// DELETE /gallery/albums/{id}

export const GalleryAlbumControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const galleryAlbumControllerRemoveOperation: OperationDefinition = {
  id: 'GalleryAlbumController_remove',
  method: 'DELETE',
  path: '/gallery/albums/{id}',
  responseTypes: { 204: 'none' },
  schemas: GalleryAlbumControllerRemoveSchemas,
};

/** 刪除相簿（移到回收桶；圖片不刪） */
export function galleryAlbumControllerRemove(
  input: GalleryAlbumControllerRemoveInput,
  options?: RequestOptions,
): Promise<GalleryAlbumControllerRemoveResult> {
  return request<GalleryAlbumControllerRemoveResult>(
    galleryAlbumControllerRemoveOperation,
    input,
    options,
  );
}

// PATCH /gallery/albums/{id}

export const GalleryAlbumControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateGalleryAlbumRequestSchema,
  responses: {
    200: z.object({
      data: GalleryAlbumSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryAlbumControllerUpdateOperation: OperationDefinition = {
  id: 'GalleryAlbumController_update',
  method: 'PATCH',
  path: '/gallery/albums/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: GalleryAlbumControllerUpdateSchemas,
};

/** 改名、說明、封面（樂觀鎖） */
export function galleryAlbumControllerUpdate(
  input: GalleryAlbumControllerUpdateInput,
  options?: RequestOptions,
): Promise<GalleryAlbumControllerUpdateResult> {
  return request<GalleryAlbumControllerUpdateResult>(
    galleryAlbumControllerUpdateOperation,
    input,
    options,
  );
}

// POST /gallery/albums/{id}/restore

export const GalleryAlbumControllerRestoreSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: GalleryAlbumSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryAlbumControllerRestoreOperation: OperationDefinition = {
  id: 'GalleryAlbumController_restore',
  method: 'POST',
  path: '/gallery/albums/{id}/restore',
  responseTypes: { 200: 'json' },
  schemas: GalleryAlbumControllerRestoreSchemas,
};

/** 還原刪除的相簿 */
export function galleryAlbumControllerRestore(
  input: GalleryAlbumControllerRestoreInput,
  options?: RequestOptions,
): Promise<GalleryAlbumControllerRestoreResult> {
  return request<GalleryAlbumControllerRestoreResult>(
    galleryAlbumControllerRestoreOperation,
    input,
    options,
  );
}

// POST /gallery/albums/{id}/items

export const GalleryAlbumControllerAddItemsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: GalleryAlbumItemsRequestSchema,
  responses: {
    200: z.object({
      data: GalleryAlbumItemsResultSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryAlbumControllerAddItemsOperation: OperationDefinition = {
  id: 'GalleryAlbumController_addItems',
  method: 'POST',
  path: '/gallery/albums/{id}/items',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: GalleryAlbumControllerAddItemsSchemas,
};

/** 加入圖片（已經在的略過） */
export function galleryAlbumControllerAddItems(
  input: GalleryAlbumControllerAddItemsInput,
  options?: RequestOptions,
): Promise<GalleryAlbumControllerAddItemsResult> {
  return request<GalleryAlbumControllerAddItemsResult>(
    galleryAlbumControllerAddItemsOperation,
    input,
    options,
  );
}

// POST /gallery/albums/{id}/items/remove

export const GalleryAlbumControllerRemoveItemsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: GalleryAlbumItemsRequestSchema,
  responses: {
    200: z.object({
      data: GalleryAlbumItemsResultSchema,
    }),
  },
} satisfies OperationSchemas;

const galleryAlbumControllerRemoveItemsOperation: OperationDefinition = {
  id: 'GalleryAlbumController_removeItems',
  method: 'POST',
  path: '/gallery/albums/{id}/items/remove',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: GalleryAlbumControllerRemoveItemsSchemas,
};

/** 移出圖片（圖片本身不刪） */
export function galleryAlbumControllerRemoveItems(
  input: GalleryAlbumControllerRemoveItemsInput,
  options?: RequestOptions,
): Promise<GalleryAlbumControllerRemoveItemsResult> {
  return request<GalleryAlbumControllerRemoveItemsResult>(
    galleryAlbumControllerRemoveItemsOperation,
    input,
    options,
  );
}
