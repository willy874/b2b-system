// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CreateIdentityProviderRequest,
  IdentityProvider,
  IdentityProviderList,
  UpdateIdentityProviderRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /identity-providers

export interface IdentityProviderControllerListResponses {
  200: {
    data: IdentityProviderList;
  };
}

export type IdentityProviderControllerListResponse = IdentityProviderControllerListResponses[200];

export type IdentityProviderControllerListResult = ApiResponse<
  200,
  IdentityProviderControllerListResponses[200]
>;

export function getIdentityProviderControllerListUrl(): string {
  return buildUrl('/identity-providers');
}

// POST /identity-providers

export type IdentityProviderControllerCreateBody = CreateIdentityProviderRequest;

export interface IdentityProviderControllerCreateInput {
  body: IdentityProviderControllerCreateBody;
}

export interface IdentityProviderControllerCreateResponses {
  201: {
    data: IdentityProvider;
  };
}

export type IdentityProviderControllerCreateResponse =
  IdentityProviderControllerCreateResponses[201];

export type IdentityProviderControllerCreateResult = ApiResponse<
  201,
  IdentityProviderControllerCreateResponses[201]
>;

export function getIdentityProviderControllerCreateUrl(): string {
  return buildUrl('/identity-providers');
}

// DELETE /identity-providers/{id}

export interface IdentityProviderControllerRemovePathParams {
  id: string;
}

export interface IdentityProviderControllerRemoveInput {
  path: IdentityProviderControllerRemovePathParams;
}

export interface IdentityProviderControllerRemoveResponses {
  204: undefined;
}

export type IdentityProviderControllerRemoveResponse =
  IdentityProviderControllerRemoveResponses[204];

export type IdentityProviderControllerRemoveResult = ApiResponse<
  204,
  IdentityProviderControllerRemoveResponses[204]
>;

export function getIdentityProviderControllerRemoveUrl(
  path: IdentityProviderControllerRemovePathParams,
): string {
  return buildUrl('/identity-providers/{id}', path);
}

// PATCH /identity-providers/{id}

export interface IdentityProviderControllerUpdatePathParams {
  id: string;
}

export type IdentityProviderControllerUpdateBody = UpdateIdentityProviderRequest;

export interface IdentityProviderControllerUpdateInput {
  path: IdentityProviderControllerUpdatePathParams;
  body: IdentityProviderControllerUpdateBody;
}

export interface IdentityProviderControllerUpdateResponses {
  200: {
    data: IdentityProvider;
  };
}

export type IdentityProviderControllerUpdateResponse =
  IdentityProviderControllerUpdateResponses[200];

export type IdentityProviderControllerUpdateResult = ApiResponse<
  200,
  IdentityProviderControllerUpdateResponses[200]
>;

export function getIdentityProviderControllerUpdateUrl(
  path: IdentityProviderControllerUpdatePathParams,
): string {
  return buildUrl('/identity-providers/{id}', path);
}
