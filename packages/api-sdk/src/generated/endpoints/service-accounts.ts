// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  ApiTokenList,
  CreateApiTokenRequest,
  CreateServiceAccountRequest,
  CreatedApiToken,
  ReplaceServiceAccountRolesRequest,
  ServiceAccount,
  ServiceAccountRoles,
  UpdateServiceAccountRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /service-accounts

export interface ServiceAccountControllerListResponses {
  200: {
    data: {
      items: Array<ServiceAccount>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type ServiceAccountControllerListResponse = ServiceAccountControllerListResponses[200];

export type ServiceAccountControllerListResult = ApiResponse<
  200,
  ServiceAccountControllerListResponses[200]
>;

export function getServiceAccountControllerListUrl(): string {
  return buildUrl('/service-accounts');
}

// POST /service-accounts

export type ServiceAccountControllerCreateBody = CreateServiceAccountRequest;

export interface ServiceAccountControllerCreateInput {
  body: ServiceAccountControllerCreateBody;
}

export interface ServiceAccountControllerCreateResponses {
  201: {
    data: ServiceAccount;
  };
}

export type ServiceAccountControllerCreateResponse = ServiceAccountControllerCreateResponses[201];

export type ServiceAccountControllerCreateResult = ApiResponse<
  201,
  ServiceAccountControllerCreateResponses[201]
>;

export function getServiceAccountControllerCreateUrl(): string {
  return buildUrl('/service-accounts');
}

// GET /service-accounts/{id}

export interface ServiceAccountControllerFindOnePathParams {
  id: string;
}

export interface ServiceAccountControllerFindOneInput {
  path: ServiceAccountControllerFindOnePathParams;
}

export interface ServiceAccountControllerFindOneResponses {
  200: {
    data: ServiceAccount;
  };
}

export type ServiceAccountControllerFindOneResponse = ServiceAccountControllerFindOneResponses[200];

export type ServiceAccountControllerFindOneResult = ApiResponse<
  200,
  ServiceAccountControllerFindOneResponses[200]
>;

export function getServiceAccountControllerFindOneUrl(
  path: ServiceAccountControllerFindOnePathParams,
): string {
  return buildUrl('/service-accounts/{id}', path);
}

// DELETE /service-accounts/{id}

export interface ServiceAccountControllerRemovePathParams {
  id: string;
}

export interface ServiceAccountControllerRemoveInput {
  path: ServiceAccountControllerRemovePathParams;
}

export interface ServiceAccountControllerRemoveResponses {
  204: undefined;
}

export type ServiceAccountControllerRemoveResponse = ServiceAccountControllerRemoveResponses[204];

export type ServiceAccountControllerRemoveResult = ApiResponse<
  204,
  ServiceAccountControllerRemoveResponses[204]
>;

export function getServiceAccountControllerRemoveUrl(
  path: ServiceAccountControllerRemovePathParams,
): string {
  return buildUrl('/service-accounts/{id}', path);
}

// PATCH /service-accounts/{id}

export interface ServiceAccountControllerUpdatePathParams {
  id: string;
}

export type ServiceAccountControllerUpdateBody = UpdateServiceAccountRequest;

export interface ServiceAccountControllerUpdateInput {
  path: ServiceAccountControllerUpdatePathParams;
  body: ServiceAccountControllerUpdateBody;
}

export interface ServiceAccountControllerUpdateResponses {
  200: {
    data: ServiceAccount;
  };
}

export type ServiceAccountControllerUpdateResponse = ServiceAccountControllerUpdateResponses[200];

export type ServiceAccountControllerUpdateResult = ApiResponse<
  200,
  ServiceAccountControllerUpdateResponses[200]
>;

export function getServiceAccountControllerUpdateUrl(
  path: ServiceAccountControllerUpdatePathParams,
): string {
  return buildUrl('/service-accounts/{id}', path);
}

// PUT /service-accounts/{id}/roles

export interface ServiceAccountControllerReplaceRolesPathParams {
  id: string;
}

export type ServiceAccountControllerReplaceRolesBody = ReplaceServiceAccountRolesRequest;

export interface ServiceAccountControllerReplaceRolesInput {
  path: ServiceAccountControllerReplaceRolesPathParams;
  body: ServiceAccountControllerReplaceRolesBody;
}

export interface ServiceAccountControllerReplaceRolesResponses {
  200: {
    data: ServiceAccountRoles;
  };
}

export type ServiceAccountControllerReplaceRolesResponse =
  ServiceAccountControllerReplaceRolesResponses[200];

export type ServiceAccountControllerReplaceRolesResult = ApiResponse<
  200,
  ServiceAccountControllerReplaceRolesResponses[200]
>;

export function getServiceAccountControllerReplaceRolesUrl(
  path: ServiceAccountControllerReplaceRolesPathParams,
): string {
  return buildUrl('/service-accounts/{id}/roles', path);
}

// GET /service-accounts/{id}/tokens

export interface ServiceAccountControllerListTokensPathParams {
  id: string;
}

export interface ServiceAccountControllerListTokensInput {
  path: ServiceAccountControllerListTokensPathParams;
}

export interface ServiceAccountControllerListTokensResponses {
  200: {
    data: ApiTokenList;
  };
}

export type ServiceAccountControllerListTokensResponse =
  ServiceAccountControllerListTokensResponses[200];

export type ServiceAccountControllerListTokensResult = ApiResponse<
  200,
  ServiceAccountControllerListTokensResponses[200]
>;

export function getServiceAccountControllerListTokensUrl(
  path: ServiceAccountControllerListTokensPathParams,
): string {
  return buildUrl('/service-accounts/{id}/tokens', path);
}

// POST /service-accounts/{id}/tokens

export interface ServiceAccountControllerCreateTokenPathParams {
  id: string;
}

export type ServiceAccountControllerCreateTokenBody = CreateApiTokenRequest;

export interface ServiceAccountControllerCreateTokenInput {
  path: ServiceAccountControllerCreateTokenPathParams;
  body: ServiceAccountControllerCreateTokenBody;
}

export interface ServiceAccountControllerCreateTokenResponses {
  201: {
    data: CreatedApiToken;
  };
}

export type ServiceAccountControllerCreateTokenResponse =
  ServiceAccountControllerCreateTokenResponses[201];

export type ServiceAccountControllerCreateTokenResult = ApiResponse<
  201,
  ServiceAccountControllerCreateTokenResponses[201]
>;

export function getServiceAccountControllerCreateTokenUrl(
  path: ServiceAccountControllerCreateTokenPathParams,
): string {
  return buildUrl('/service-accounts/{id}/tokens', path);
}

// DELETE /service-accounts/{id}/tokens/{tokenId}

export interface ServiceAccountControllerRevokeTokenPathParams {
  id: string;
  tokenId: string;
}

export interface ServiceAccountControllerRevokeTokenInput {
  path: ServiceAccountControllerRevokeTokenPathParams;
}

export interface ServiceAccountControllerRevokeTokenResponses {
  204: undefined;
}

export type ServiceAccountControllerRevokeTokenResponse =
  ServiceAccountControllerRevokeTokenResponses[204];

export type ServiceAccountControllerRevokeTokenResult = ApiResponse<
  204,
  ServiceAccountControllerRevokeTokenResponses[204]
>;

export function getServiceAccountControllerRevokeTokenUrl(
  path: ServiceAccountControllerRevokeTokenPathParams,
): string {
  return buildUrl('/service-accounts/{id}/tokens/{tokenId}', path);
}
