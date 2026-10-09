// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CreateGalleryAlbumRequest,
  CreateGalleryFromSourceRequest,
  CreateGalleryUploadRequest,
  GalleryAlbum,
  GalleryAlbumItemsRequest,
  GalleryAlbumItemsResult,
  GalleryAlbumList,
  GalleryFromSourceResult,
  GalleryItemDetail,
  GalleryItemList,
  GalleryNeighbors,
  GalleryTimeline,
  GalleryUpload,
  GalleryUploadItem,
  GalleryUploadStatus,
  UpdateGalleryAlbumRequest,
  UpdateGalleryItemRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /gallery/items

export interface GalleryItemControllerListResponses {
  200: {
    data: GalleryItemList;
  };
}

export type GalleryItemControllerListResponse = GalleryItemControllerListResponses[200];

export type GalleryItemControllerListResult = ApiResponse<
  200,
  GalleryItemControllerListResponses[200]
>;

export function getGalleryItemControllerListUrl(): string {
  return buildUrl('/gallery/items');
}

// POST /gallery/items

export type GalleryItemControllerCreateUploadBody = CreateGalleryUploadRequest;

export interface GalleryItemControllerCreateUploadInput {
  body: GalleryItemControllerCreateUploadBody;
}

export interface GalleryItemControllerCreateUploadResponses {
  201: {
    data: GalleryUpload;
  };
}

export type GalleryItemControllerCreateUploadResponse =
  GalleryItemControllerCreateUploadResponses[201];

export type GalleryItemControllerCreateUploadResult = ApiResponse<
  201,
  GalleryItemControllerCreateUploadResponses[201]
>;

export function getGalleryItemControllerCreateUploadUrl(): string {
  return buildUrl('/gallery/items');
}

// GET /gallery/items/timeline

export interface GalleryItemControllerTimelineResponses {
  200: {
    data: GalleryTimeline;
  };
}

export type GalleryItemControllerTimelineResponse = GalleryItemControllerTimelineResponses[200];

export type GalleryItemControllerTimelineResult = ApiResponse<
  200,
  GalleryItemControllerTimelineResponses[200]
>;

export function getGalleryItemControllerTimelineUrl(): string {
  return buildUrl('/gallery/items/timeline');
}

// GET /gallery/items/uploads

export interface GalleryItemControllerUploadsResponses {
  200: {
    data: GalleryUploadStatus;
  };
}

export type GalleryItemControllerUploadsResponse = GalleryItemControllerUploadsResponses[200];

export type GalleryItemControllerUploadsResult = ApiResponse<
  200,
  GalleryItemControllerUploadsResponses[200]
>;

export function getGalleryItemControllerUploadsUrl(): string {
  return buildUrl('/gallery/items/uploads');
}

// DELETE /gallery/items/uploads/failed

export interface GalleryItemControllerClearFailedResponses {
  204: undefined;
}

export type GalleryItemControllerClearFailedResponse =
  GalleryItemControllerClearFailedResponses[204];

export type GalleryItemControllerClearFailedResult = ApiResponse<
  204,
  GalleryItemControllerClearFailedResponses[204]
>;

export function getGalleryItemControllerClearFailedUrl(): string {
  return buildUrl('/gallery/items/uploads/failed');
}

// POST /gallery/items/from-source

export type GalleryItemControllerCreateFromSourceBody = CreateGalleryFromSourceRequest;

export interface GalleryItemControllerCreateFromSourceInput {
  body: GalleryItemControllerCreateFromSourceBody;
}

export interface GalleryItemControllerCreateFromSourceResponses {
  200: {
    data: GalleryFromSourceResult;
  };
}

export type GalleryItemControllerCreateFromSourceResponse =
  GalleryItemControllerCreateFromSourceResponses[200];

export type GalleryItemControllerCreateFromSourceResult = ApiResponse<
  200,
  GalleryItemControllerCreateFromSourceResponses[200]
>;

export function getGalleryItemControllerCreateFromSourceUrl(): string {
  return buildUrl('/gallery/items/from-source');
}

// POST /gallery/items/{id}/complete

export interface GalleryItemControllerCompleteUploadPathParams {
  id: string;
}

export interface GalleryItemControllerCompleteUploadInput {
  path: GalleryItemControllerCompleteUploadPathParams;
}

export interface GalleryItemControllerCompleteUploadResponses {
  200: {
    data: GalleryUploadItem;
  };
}

export type GalleryItemControllerCompleteUploadResponse =
  GalleryItemControllerCompleteUploadResponses[200];

export type GalleryItemControllerCompleteUploadResult = ApiResponse<
  200,
  GalleryItemControllerCompleteUploadResponses[200]
>;

export function getGalleryItemControllerCompleteUploadUrl(
  path: GalleryItemControllerCompleteUploadPathParams,
): string {
  return buildUrl('/gallery/items/{id}/complete', path);
}

// GET /gallery/items/{id}

export interface GalleryItemControllerFindOnePathParams {
  id: string;
}

export interface GalleryItemControllerFindOneInput {
  path: GalleryItemControllerFindOnePathParams;
}

export interface GalleryItemControllerFindOneResponses {
  200: {
    data: GalleryItemDetail;
  };
}

export type GalleryItemControllerFindOneResponse = GalleryItemControllerFindOneResponses[200];

export type GalleryItemControllerFindOneResult = ApiResponse<
  200,
  GalleryItemControllerFindOneResponses[200]
>;

export function getGalleryItemControllerFindOneUrl(
  path: GalleryItemControllerFindOnePathParams,
): string {
  return buildUrl('/gallery/items/{id}', path);
}

// DELETE /gallery/items/{id}

export interface GalleryItemControllerRemovePathParams {
  id: string;
}

export interface GalleryItemControllerRemoveInput {
  path: GalleryItemControllerRemovePathParams;
}

export interface GalleryItemControllerRemoveResponses {
  204: undefined;
}

export type GalleryItemControllerRemoveResponse = GalleryItemControllerRemoveResponses[204];

export type GalleryItemControllerRemoveResult = ApiResponse<
  204,
  GalleryItemControllerRemoveResponses[204]
>;

export function getGalleryItemControllerRemoveUrl(
  path: GalleryItemControllerRemovePathParams,
): string {
  return buildUrl('/gallery/items/{id}', path);
}

// PATCH /gallery/items/{id}

export interface GalleryItemControllerUpdatePathParams {
  id: string;
}

export type GalleryItemControllerUpdateBody = UpdateGalleryItemRequest;

export interface GalleryItemControllerUpdateInput {
  path: GalleryItemControllerUpdatePathParams;
  body: GalleryItemControllerUpdateBody;
}

export interface GalleryItemControllerUpdateResponses {
  200: {
    data: GalleryItemDetail;
  };
}

export type GalleryItemControllerUpdateResponse = GalleryItemControllerUpdateResponses[200];

export type GalleryItemControllerUpdateResult = ApiResponse<
  200,
  GalleryItemControllerUpdateResponses[200]
>;

export function getGalleryItemControllerUpdateUrl(
  path: GalleryItemControllerUpdatePathParams,
): string {
  return buildUrl('/gallery/items/{id}', path);
}

// GET /gallery/items/{id}/neighbors

export interface GalleryItemControllerNeighborsPathParams {
  id: string;
}

export interface GalleryItemControllerNeighborsInput {
  path: GalleryItemControllerNeighborsPathParams;
}

export interface GalleryItemControllerNeighborsResponses {
  200: {
    data: GalleryNeighbors;
  };
}

export type GalleryItemControllerNeighborsResponse = GalleryItemControllerNeighborsResponses[200];

export type GalleryItemControllerNeighborsResult = ApiResponse<
  200,
  GalleryItemControllerNeighborsResponses[200]
>;

export function getGalleryItemControllerNeighborsUrl(
  path: GalleryItemControllerNeighborsPathParams,
): string {
  return buildUrl('/gallery/items/{id}/neighbors', path);
}

// POST /gallery/items/{id}/restore

export interface GalleryItemControllerRestorePathParams {
  id: string;
}

export interface GalleryItemControllerRestoreInput {
  path: GalleryItemControllerRestorePathParams;
}

export interface GalleryItemControllerRestoreResponses {
  200: {
    data: GalleryItemDetail;
  };
}

export type GalleryItemControllerRestoreResponse = GalleryItemControllerRestoreResponses[200];

export type GalleryItemControllerRestoreResult = ApiResponse<
  200,
  GalleryItemControllerRestoreResponses[200]
>;

export function getGalleryItemControllerRestoreUrl(
  path: GalleryItemControllerRestorePathParams,
): string {
  return buildUrl('/gallery/items/{id}/restore', path);
}

// GET /gallery/albums

export interface GalleryAlbumControllerListResponses {
  200: {
    data: GalleryAlbumList;
  };
}

export type GalleryAlbumControllerListResponse = GalleryAlbumControllerListResponses[200];

export type GalleryAlbumControllerListResult = ApiResponse<
  200,
  GalleryAlbumControllerListResponses[200]
>;

export function getGalleryAlbumControllerListUrl(): string {
  return buildUrl('/gallery/albums');
}

// POST /gallery/albums

export type GalleryAlbumControllerCreateBody = CreateGalleryAlbumRequest;

export interface GalleryAlbumControllerCreateInput {
  body: GalleryAlbumControllerCreateBody;
}

export interface GalleryAlbumControllerCreateResponses {
  201: {
    data: GalleryAlbum;
  };
}

export type GalleryAlbumControllerCreateResponse = GalleryAlbumControllerCreateResponses[201];

export type GalleryAlbumControllerCreateResult = ApiResponse<
  201,
  GalleryAlbumControllerCreateResponses[201]
>;

export function getGalleryAlbumControllerCreateUrl(): string {
  return buildUrl('/gallery/albums');
}

// GET /gallery/albums/{id}

export interface GalleryAlbumControllerFindOnePathParams {
  id: string;
}

export interface GalleryAlbumControllerFindOneInput {
  path: GalleryAlbumControllerFindOnePathParams;
}

export interface GalleryAlbumControllerFindOneResponses {
  200: {
    data: GalleryAlbum;
  };
}

export type GalleryAlbumControllerFindOneResponse = GalleryAlbumControllerFindOneResponses[200];

export type GalleryAlbumControllerFindOneResult = ApiResponse<
  200,
  GalleryAlbumControllerFindOneResponses[200]
>;

export function getGalleryAlbumControllerFindOneUrl(
  path: GalleryAlbumControllerFindOnePathParams,
): string {
  return buildUrl('/gallery/albums/{id}', path);
}

// DELETE /gallery/albums/{id}

export interface GalleryAlbumControllerRemovePathParams {
  id: string;
}

export interface GalleryAlbumControllerRemoveInput {
  path: GalleryAlbumControllerRemovePathParams;
}

export interface GalleryAlbumControllerRemoveResponses {
  204: undefined;
}

export type GalleryAlbumControllerRemoveResponse = GalleryAlbumControllerRemoveResponses[204];

export type GalleryAlbumControllerRemoveResult = ApiResponse<
  204,
  GalleryAlbumControllerRemoveResponses[204]
>;

export function getGalleryAlbumControllerRemoveUrl(
  path: GalleryAlbumControllerRemovePathParams,
): string {
  return buildUrl('/gallery/albums/{id}', path);
}

// PATCH /gallery/albums/{id}

export interface GalleryAlbumControllerUpdatePathParams {
  id: string;
}

export type GalleryAlbumControllerUpdateBody = UpdateGalleryAlbumRequest;

export interface GalleryAlbumControllerUpdateInput {
  path: GalleryAlbumControllerUpdatePathParams;
  body: GalleryAlbumControllerUpdateBody;
}

export interface GalleryAlbumControllerUpdateResponses {
  200: {
    data: GalleryAlbum;
  };
}

export type GalleryAlbumControllerUpdateResponse = GalleryAlbumControllerUpdateResponses[200];

export type GalleryAlbumControllerUpdateResult = ApiResponse<
  200,
  GalleryAlbumControllerUpdateResponses[200]
>;

export function getGalleryAlbumControllerUpdateUrl(
  path: GalleryAlbumControllerUpdatePathParams,
): string {
  return buildUrl('/gallery/albums/{id}', path);
}

// POST /gallery/albums/{id}/restore

export interface GalleryAlbumControllerRestorePathParams {
  id: string;
}

export interface GalleryAlbumControllerRestoreInput {
  path: GalleryAlbumControllerRestorePathParams;
}

export interface GalleryAlbumControllerRestoreResponses {
  200: {
    data: GalleryAlbum;
  };
}

export type GalleryAlbumControllerRestoreResponse = GalleryAlbumControllerRestoreResponses[200];

export type GalleryAlbumControllerRestoreResult = ApiResponse<
  200,
  GalleryAlbumControllerRestoreResponses[200]
>;

export function getGalleryAlbumControllerRestoreUrl(
  path: GalleryAlbumControllerRestorePathParams,
): string {
  return buildUrl('/gallery/albums/{id}/restore', path);
}

// POST /gallery/albums/{id}/items

export interface GalleryAlbumControllerAddItemsPathParams {
  id: string;
}

export type GalleryAlbumControllerAddItemsBody = GalleryAlbumItemsRequest;

export interface GalleryAlbumControllerAddItemsInput {
  path: GalleryAlbumControllerAddItemsPathParams;
  body: GalleryAlbumControllerAddItemsBody;
}

export interface GalleryAlbumControllerAddItemsResponses {
  200: {
    data: GalleryAlbumItemsResult;
  };
}

export type GalleryAlbumControllerAddItemsResponse = GalleryAlbumControllerAddItemsResponses[200];

export type GalleryAlbumControllerAddItemsResult = ApiResponse<
  200,
  GalleryAlbumControllerAddItemsResponses[200]
>;

export function getGalleryAlbumControllerAddItemsUrl(
  path: GalleryAlbumControllerAddItemsPathParams,
): string {
  return buildUrl('/gallery/albums/{id}/items', path);
}

// POST /gallery/albums/{id}/items/remove

export interface GalleryAlbumControllerRemoveItemsPathParams {
  id: string;
}

export type GalleryAlbumControllerRemoveItemsBody = GalleryAlbumItemsRequest;

export interface GalleryAlbumControllerRemoveItemsInput {
  path: GalleryAlbumControllerRemoveItemsPathParams;
  body: GalleryAlbumControllerRemoveItemsBody;
}

export interface GalleryAlbumControllerRemoveItemsResponses {
  200: {
    data: GalleryAlbumItemsResult;
  };
}

export type GalleryAlbumControllerRemoveItemsResponse =
  GalleryAlbumControllerRemoveItemsResponses[200];

export type GalleryAlbumControllerRemoveItemsResult = ApiResponse<
  200,
  GalleryAlbumControllerRemoveItemsResponses[200]
>;

export function getGalleryAlbumControllerRemoveItemsUrl(
  path: GalleryAlbumControllerRemoveItemsPathParams,
): string {
  return buildUrl('/gallery/albums/{id}/items/remove', path);
}
