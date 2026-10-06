// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CreateTagRequest,
  ReplaceResourceTagsRequest,
  ResourceTags,
  Tag,
  TagList,
  UpdateTagRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /tags

export interface TagControllerListResponses {
  200: {
    data: TagList;
  };
}

export type TagControllerListResponse = TagControllerListResponses[200];

export type TagControllerListResult = ApiResponse<200, TagControllerListResponses[200]>;

export function getTagControllerListUrl(): string {
  return buildUrl('/tags');
}

// POST /tags

export type TagControllerCreateBody = CreateTagRequest;

export interface TagControllerCreateInput {
  body: TagControllerCreateBody;
}

export interface TagControllerCreateResponses {
  201: {
    data: Tag;
  };
}

export type TagControllerCreateResponse = TagControllerCreateResponses[201];

export type TagControllerCreateResult = ApiResponse<201, TagControllerCreateResponses[201]>;

export function getTagControllerCreateUrl(): string {
  return buildUrl('/tags');
}

// DELETE /tags/{id}

export interface TagControllerRemovePathParams {
  id: string;
}

export interface TagControllerRemoveInput {
  path: TagControllerRemovePathParams;
}

export interface TagControllerRemoveResponses {
  204: undefined;
}

export type TagControllerRemoveResponse = TagControllerRemoveResponses[204];

export type TagControllerRemoveResult = ApiResponse<204, TagControllerRemoveResponses[204]>;

export function getTagControllerRemoveUrl(path: TagControllerRemovePathParams): string {
  return buildUrl('/tags/{id}', path);
}

// PATCH /tags/{id}

export interface TagControllerUpdatePathParams {
  id: string;
}

export type TagControllerUpdateBody = UpdateTagRequest;

export interface TagControllerUpdateInput {
  path: TagControllerUpdatePathParams;
  body: TagControllerUpdateBody;
}

export interface TagControllerUpdateResponses {
  200: {
    data: Tag;
  };
}

export type TagControllerUpdateResponse = TagControllerUpdateResponses[200];

export type TagControllerUpdateResult = ApiResponse<200, TagControllerUpdateResponses[200]>;

export function getTagControllerUpdateUrl(path: TagControllerUpdatePathParams): string {
  return buildUrl('/tags/{id}', path);
}

// PUT /tags/assignments/{resourceType}/{resourceId}

export interface TagControllerReplacePathParams {
  resourceType: string;
  resourceId: string;
}

export type TagControllerReplaceBody = ReplaceResourceTagsRequest;

export interface TagControllerReplaceInput {
  path: TagControllerReplacePathParams;
  body: TagControllerReplaceBody;
}

export interface TagControllerReplaceResponses {
  200: {
    data: ResourceTags;
  };
}

export type TagControllerReplaceResponse = TagControllerReplaceResponses[200];

export type TagControllerReplaceResult = ApiResponse<200, TagControllerReplaceResponses[200]>;

export function getTagControllerReplaceUrl(path: TagControllerReplacePathParams): string {
  return buildUrl('/tags/assignments/{resourceType}/{resourceId}', path);
}
