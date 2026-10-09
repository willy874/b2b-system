// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CompleteImageUploadRequest,
  CreateImageFromSourceRequest,
  CreateImageUploadRequest,
  ImageAsset,
  ImageAssetList,
  ImageUpload,
  ImageUsageList,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /images/usages

export interface ImageControllerListUsagesResponses {
  200: {
    data: ImageUsageList;
  };
}

export type ImageControllerListUsagesResponse = ImageControllerListUsagesResponses[200];

export type ImageControllerListUsagesResult = ApiResponse<
  200,
  ImageControllerListUsagesResponses[200]
>;

export function getImageControllerListUsagesUrl(): string {
  return buildUrl('/images/usages');
}

// GET /images/recent

export interface ImageControllerRecentResponses {
  200: {
    data: ImageAssetList;
  };
}

export type ImageControllerRecentResponse = ImageControllerRecentResponses[200];

export type ImageControllerRecentResult = ApiResponse<200, ImageControllerRecentResponses[200]>;

export function getImageControllerRecentUrl(): string {
  return buildUrl('/images/recent');
}

// POST /images

export type ImageControllerCreateUploadBody = CreateImageUploadRequest;

export interface ImageControllerCreateUploadInput {
  body: ImageControllerCreateUploadBody;
}

export interface ImageControllerCreateUploadResponses {
  201: {
    data: ImageUpload;
  };
}

export type ImageControllerCreateUploadResponse = ImageControllerCreateUploadResponses[201];

export type ImageControllerCreateUploadResult = ApiResponse<
  201,
  ImageControllerCreateUploadResponses[201]
>;

export function getImageControllerCreateUploadUrl(): string {
  return buildUrl('/images');
}

// POST /images/from-source

export type ImageControllerCreateFromSourceBody = CreateImageFromSourceRequest;

export interface ImageControllerCreateFromSourceInput {
  body: ImageControllerCreateFromSourceBody;
}

export interface ImageControllerCreateFromSourceResponses {
  201: {
    data: ImageAsset;
  };
}

export type ImageControllerCreateFromSourceResponse = ImageControllerCreateFromSourceResponses[201];

export type ImageControllerCreateFromSourceResult = ApiResponse<
  201,
  ImageControllerCreateFromSourceResponses[201]
>;

export function getImageControllerCreateFromSourceUrl(): string {
  return buildUrl('/images/from-source');
}

// POST /images/{id}/complete

export interface ImageControllerCompleteUploadPathParams {
  id: string;
}

export type ImageControllerCompleteUploadBody = CompleteImageUploadRequest;

export interface ImageControllerCompleteUploadInput {
  path: ImageControllerCompleteUploadPathParams;
  body: ImageControllerCompleteUploadBody;
}

export interface ImageControllerCompleteUploadResponses {
  200: {
    data: ImageAsset;
  };
}

export type ImageControllerCompleteUploadResponse = ImageControllerCompleteUploadResponses[200];

export type ImageControllerCompleteUploadResult = ApiResponse<
  200,
  ImageControllerCompleteUploadResponses[200]
>;

export function getImageControllerCompleteUploadUrl(
  path: ImageControllerCompleteUploadPathParams,
): string {
  return buildUrl('/images/{id}/complete', path);
}

// POST /images/{id}/hide-from-recent

export interface ImageControllerHideFromRecentPathParams {
  id: string;
}

export interface ImageControllerHideFromRecentInput {
  path: ImageControllerHideFromRecentPathParams;
}

export interface ImageControllerHideFromRecentResponses {
  204: undefined;
}

export type ImageControllerHideFromRecentResponse = ImageControllerHideFromRecentResponses[204];

export type ImageControllerHideFromRecentResult = ApiResponse<
  204,
  ImageControllerHideFromRecentResponses[204]
>;

export function getImageControllerHideFromRecentUrl(
  path: ImageControllerHideFromRecentPathParams,
): string {
  return buildUrl('/images/{id}/hide-from-recent', path);
}

// GET /images/{id}

export interface ImageControllerFindOnePathParams {
  id: string;
}

export interface ImageControllerFindOneInput {
  path: ImageControllerFindOnePathParams;
}

export interface ImageControllerFindOneResponses {
  200: {
    data: ImageAsset;
  };
}

export type ImageControllerFindOneResponse = ImageControllerFindOneResponses[200];

export type ImageControllerFindOneResult = ApiResponse<200, ImageControllerFindOneResponses[200]>;

export function getImageControllerFindOneUrl(path: ImageControllerFindOnePathParams): string {
  return buildUrl('/images/{id}', path);
}
