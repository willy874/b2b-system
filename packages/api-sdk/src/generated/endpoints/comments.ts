// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  Comment,
  CommentPage,
  CreateCommentRequest,
  MentionableList,
  UpdateCommentRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /comments/{resourceType}/{resourceId}

export interface CommentControllerListPathParams {
  resourceType: string;
  resourceId: string;
}

export interface CommentControllerListInput {
  path: CommentControllerListPathParams;
}

export interface CommentControllerListResponses {
  200: {
    data: CommentPage;
  };
}

export type CommentControllerListResponse = CommentControllerListResponses[200];

export type CommentControllerListResult = ApiResponse<200, CommentControllerListResponses[200]>;

export function getCommentControllerListUrl(path: CommentControllerListPathParams): string {
  return buildUrl('/comments/{resourceType}/{resourceId}', path);
}

// POST /comments/{resourceType}/{resourceId}

export interface CommentControllerCreatePathParams {
  resourceType: string;
  resourceId: string;
}

export type CommentControllerCreateBody = CreateCommentRequest;

export interface CommentControllerCreateInput {
  path: CommentControllerCreatePathParams;
  body: CommentControllerCreateBody;
}

export interface CommentControllerCreateResponses {
  201: {
    data: Comment;
  };
}

export type CommentControllerCreateResponse = CommentControllerCreateResponses[201];

export type CommentControllerCreateResult = ApiResponse<201, CommentControllerCreateResponses[201]>;

export function getCommentControllerCreateUrl(path: CommentControllerCreatePathParams): string {
  return buildUrl('/comments/{resourceType}/{resourceId}', path);
}

// GET /comments/{resourceType}/{resourceId}/mentionable

export interface CommentControllerMentionablePathParams {
  resourceType: string;
  resourceId: string;
}

export interface CommentControllerMentionableInput {
  path: CommentControllerMentionablePathParams;
}

export interface CommentControllerMentionableResponses {
  200: {
    data: MentionableList;
  };
}

export type CommentControllerMentionableResponse = CommentControllerMentionableResponses[200];

export type CommentControllerMentionableResult = ApiResponse<
  200,
  CommentControllerMentionableResponses[200]
>;

export function getCommentControllerMentionableUrl(
  path: CommentControllerMentionablePathParams,
): string {
  return buildUrl('/comments/{resourceType}/{resourceId}/mentionable', path);
}

// DELETE /comments/{id}

export interface CommentControllerRemovePathParams {
  id: string;
}

export interface CommentControllerRemoveInput {
  path: CommentControllerRemovePathParams;
}

export interface CommentControllerRemoveResponses {
  204: undefined;
}

export type CommentControllerRemoveResponse = CommentControllerRemoveResponses[204];

export type CommentControllerRemoveResult = ApiResponse<204, CommentControllerRemoveResponses[204]>;

export function getCommentControllerRemoveUrl(path: CommentControllerRemovePathParams): string {
  return buildUrl('/comments/{id}', path);
}

// PATCH /comments/{id}

export interface CommentControllerUpdatePathParams {
  id: string;
}

export type CommentControllerUpdateBody = UpdateCommentRequest;

export interface CommentControllerUpdateInput {
  path: CommentControllerUpdatePathParams;
  body: CommentControllerUpdateBody;
}

export interface CommentControllerUpdateResponses {
  200: {
    data: Comment;
  };
}

export type CommentControllerUpdateResponse = CommentControllerUpdateResponses[200];

export type CommentControllerUpdateResult = ApiResponse<200, CommentControllerUpdateResponses[200]>;

export function getCommentControllerUpdateUrl(path: CommentControllerUpdatePathParams): string {
  return buildUrl('/comments/{id}', path);
}
