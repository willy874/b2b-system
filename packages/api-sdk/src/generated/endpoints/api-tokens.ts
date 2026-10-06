// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { ApiTokenList, CreateApiTokenRequest, CreatedApiToken } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /auth/api-tokens

export interface ApiTokenControllerListResponses {
  200: {
    data: ApiTokenList;
  };
}

export type ApiTokenControllerListResponse = ApiTokenControllerListResponses[200];

export type ApiTokenControllerListResult = ApiResponse<200, ApiTokenControllerListResponses[200]>;

export function getApiTokenControllerListUrl(): string {
  return buildUrl('/auth/api-tokens');
}

// POST /auth/api-tokens

export type ApiTokenControllerCreateBody = CreateApiTokenRequest;

export interface ApiTokenControllerCreateInput {
  body: ApiTokenControllerCreateBody;
}

export interface ApiTokenControllerCreateResponses {
  201: {
    data: CreatedApiToken;
  };
}

export type ApiTokenControllerCreateResponse = ApiTokenControllerCreateResponses[201];

export type ApiTokenControllerCreateResult = ApiResponse<
  201,
  ApiTokenControllerCreateResponses[201]
>;

export function getApiTokenControllerCreateUrl(): string {
  return buildUrl('/auth/api-tokens');
}

// DELETE /auth/api-tokens/{tokenId}

export interface ApiTokenControllerRevokePathParams {
  tokenId: string;
}

export interface ApiTokenControllerRevokeInput {
  path: ApiTokenControllerRevokePathParams;
}

export interface ApiTokenControllerRevokeResponses {
  204: undefined;
}

export type ApiTokenControllerRevokeResponse = ApiTokenControllerRevokeResponses[204];

export type ApiTokenControllerRevokeResult = ApiResponse<
  204,
  ApiTokenControllerRevokeResponses[204]
>;

export function getApiTokenControllerRevokeUrl(path: ApiTokenControllerRevokePathParams): string {
  return buildUrl('/auth/api-tokens/{tokenId}', path);
}

// GET /users/{userId}/api-tokens

export interface UserApiTokenControllerListPathParams {
  userId: string;
}

export interface UserApiTokenControllerListInput {
  path: UserApiTokenControllerListPathParams;
}

export interface UserApiTokenControllerListResponses {
  200: {
    data: ApiTokenList;
  };
}

export type UserApiTokenControllerListResponse = UserApiTokenControllerListResponses[200];

export type UserApiTokenControllerListResult = ApiResponse<
  200,
  UserApiTokenControllerListResponses[200]
>;

export function getUserApiTokenControllerListUrl(
  path: UserApiTokenControllerListPathParams,
): string {
  return buildUrl('/users/{userId}/api-tokens', path);
}

// DELETE /users/{userId}/api-tokens/{tokenId}

export interface UserApiTokenControllerRevokePathParams {
  userId: string;
  tokenId: string;
}

export interface UserApiTokenControllerRevokeInput {
  path: UserApiTokenControllerRevokePathParams;
}

export interface UserApiTokenControllerRevokeResponses {
  204: undefined;
}

export type UserApiTokenControllerRevokeResponse = UserApiTokenControllerRevokeResponses[204];

export type UserApiTokenControllerRevokeResult = ApiResponse<
  204,
  UserApiTokenControllerRevokeResponses[204]
>;

export function getUserApiTokenControllerRevokeUrl(
  path: UserApiTokenControllerRevokePathParams,
): string {
  return buildUrl('/users/{userId}/api-tokens/{tokenId}', path);
}
