// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  ImageControllerCompleteUploadInput,
  ImageControllerCompleteUploadResult,
  ImageControllerCreateFromSourceInput,
  ImageControllerCreateFromSourceResult,
  ImageControllerCreateUploadInput,
  ImageControllerCreateUploadResult,
  ImageControllerFindOneInput,
  ImageControllerFindOneResult,
  ImageControllerHideFromRecentInput,
  ImageControllerHideFromRecentResult,
  ImageControllerListUsagesResult,
  ImageControllerRecentResult,
} from '../../endpoints/images';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CompleteImageUploadRequestSchema,
  CreateImageFromSourceRequestSchema,
  CreateImageUploadRequestSchema,
  ImageAssetListSchema,
  ImageAssetSchema,
  ImageUploadSchema,
  ImageUsageListSchema,
} from '../components';

// GET /images/usages

export const ImageControllerListUsagesSchemas = {
  responses: {
    200: z.object({
      data: ImageUsageListSchema,
    }),
  },
} satisfies OperationSchemas;

const imageControllerListUsagesOperation: OperationDefinition = {
  id: 'ImageController_listUsages',
  method: 'GET',
  path: '/images/usages',
  responseTypes: { 200: 'json' },
  schemas: ImageControllerListUsagesSchemas,
};

/** 每個使用圖片的地方的限制（大小、型別、最小尺寸、比例、尺寸） */
export function imageControllerListUsages(
  options?: RequestOptions,
): Promise<ImageControllerListUsagesResult> {
  return request<ImageControllerListUsagesResult>(imageControllerListUsagesOperation, {}, options);
}

// GET /images/recent

export const ImageControllerRecentSchemas = {
  responses: {
    200: z.object({
      data: ImageAssetListSchema,
    }),
  },
} satisfies OperationSchemas;

const imageControllerRecentOperation: OperationDefinition = {
  id: 'ImageController_recent',
  method: 'GET',
  path: '/images/recent',
  responseTypes: { 200: 'json' },
  schemas: ImageControllerRecentSchemas,
};

/** 最近使用：自己建立過的圖片（同一個內容只列一次，最多 30 張） */
export function imageControllerRecent(
  options?: RequestOptions,
): Promise<ImageControllerRecentResult> {
  return request<ImageControllerRecentResult>(imageControllerRecentOperation, {}, options);
}

// POST /images

export const ImageControllerCreateUploadSchemas = {
  body: CreateImageUploadRequestSchema,
  responses: {
    201: z.object({
      data: ImageUploadSchema,
    }),
  },
} satisfies OperationSchemas;

const imageControllerCreateUploadOperation: OperationDefinition = {
  id: 'ImageController_createUpload',
  method: 'POST',
  path: '/images',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: ImageControllerCreateUploadSchemas,
};

/** 登記上傳並取得直傳網址（完成後呼叫 complete） */
export function imageControllerCreateUpload(
  input: ImageControllerCreateUploadInput,
  options?: RequestOptions,
): Promise<ImageControllerCreateUploadResult> {
  return request<ImageControllerCreateUploadResult>(
    imageControllerCreateUploadOperation,
    input,
    options,
  );
}

// POST /images/from-source

export const ImageControllerCreateFromSourceSchemas = {
  body: CreateImageFromSourceRequestSchema,
  responses: {
    201: z.object({
      data: ImageAssetSchema,
    }),
  },
} satisfies OperationSchemas;

const imageControllerCreateFromSourceOperation: OperationDefinition = {
  id: 'ImageController_createFromSource',
  method: 'POST',
  path: '/images/from-source',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: ImageControllerCreateFromSourceSchemas,
};

/** 從其他來源（檔案管理、圖片庫、最近使用）複製成一張新的圖片 */
export function imageControllerCreateFromSource(
  input: ImageControllerCreateFromSourceInput,
  options?: RequestOptions,
): Promise<ImageControllerCreateFromSourceResult> {
  return request<ImageControllerCreateFromSourceResult>(
    imageControllerCreateFromSourceOperation,
    input,
    options,
  );
}

// POST /images/{id}/complete

export const ImageControllerCompleteUploadSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: CompleteImageUploadRequestSchema,
  responses: {
    200: z.object({
      data: ImageAssetSchema,
    }),
  },
} satisfies OperationSchemas;

const imageControllerCompleteUploadOperation: OperationDefinition = {
  id: 'ImageController_completeUpload',
  method: 'POST',
  path: '/images/{id}/complete',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: ImageControllerCompleteUploadSchemas,
};

/** 確認直傳完成並排入處理（可一併帶裁切） */
export function imageControllerCompleteUpload(
  input: ImageControllerCompleteUploadInput,
  options?: RequestOptions,
): Promise<ImageControllerCompleteUploadResult> {
  return request<ImageControllerCompleteUploadResult>(
    imageControllerCompleteUploadOperation,
    input,
    options,
  );
}

// POST /images/{id}/hide-from-recent

export const ImageControllerHideFromRecentSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const imageControllerHideFromRecentOperation: OperationDefinition = {
  id: 'ImageController_hideFromRecent',
  method: 'POST',
  path: '/images/{id}/hide-from-recent',
  responseTypes: { 204: 'none' },
  schemas: ImageControllerHideFromRecentSchemas,
};

/** 從最近使用移除（不影響正在使用它的地方） */
export function imageControllerHideFromRecent(
  input: ImageControllerHideFromRecentInput,
  options?: RequestOptions,
): Promise<ImageControllerHideFromRecentResult> {
  return request<ImageControllerHideFromRecentResult>(
    imageControllerHideFromRecentOperation,
    input,
    options,
  );
}

// GET /images/{id}

export const ImageControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: ImageAssetSchema,
    }),
  },
} satisfies OperationSchemas;

const imageControllerFindOneOperation: OperationDefinition = {
  id: 'ImageController_findOne',
  method: 'GET',
  path: '/images/{id}',
  responseTypes: { 200: 'json' },
  schemas: ImageControllerFindOneSchemas,
};

/** 自己建立的一張圖片（處理狀態、各尺寸的網址） */
export function imageControllerFindOne(
  input: ImageControllerFindOneInput,
  options?: RequestOptions,
): Promise<ImageControllerFindOneResult> {
  return request<ImageControllerFindOneResult>(imageControllerFindOneOperation, input, options);
}
