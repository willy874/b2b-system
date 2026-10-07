// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  AddTenantDomainRequest,
  CreateTenantRequest,
  PlatformTenant,
  PlatformTenantList,
  TenantFeatureImpact,
  UpdateTenantRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /platform/tenants

export interface PlatformTenantControllerListResponses {
  200: {
    data: PlatformTenantList;
  };
}

export type PlatformTenantControllerListResponse = PlatformTenantControllerListResponses[200];

export type PlatformTenantControllerListResult = ApiResponse<
  200,
  PlatformTenantControllerListResponses[200]
>;

export function getPlatformTenantControllerListUrl(): string {
  return buildUrl('/platform/tenants');
}

// POST /platform/tenants

export type PlatformTenantControllerCreateBody = CreateTenantRequest;

export interface PlatformTenantControllerCreateInput {
  body: PlatformTenantControllerCreateBody;
}

export interface PlatformTenantControllerCreateResponses {
  201: {
    data: PlatformTenant;
  };
}

export type PlatformTenantControllerCreateResponse = PlatformTenantControllerCreateResponses[201];

export type PlatformTenantControllerCreateResult = ApiResponse<
  201,
  PlatformTenantControllerCreateResponses[201]
>;

export function getPlatformTenantControllerCreateUrl(): string {
  return buildUrl('/platform/tenants');
}

// GET /platform/tenants/{id}

export interface PlatformTenantControllerGetPathParams {
  id: string;
}

export interface PlatformTenantControllerGetInput {
  path: PlatformTenantControllerGetPathParams;
}

export interface PlatformTenantControllerGetResponses {
  200: {
    data: PlatformTenant;
  };
}

export type PlatformTenantControllerGetResponse = PlatformTenantControllerGetResponses[200];

export type PlatformTenantControllerGetResult = ApiResponse<
  200,
  PlatformTenantControllerGetResponses[200]
>;

export function getPlatformTenantControllerGetUrl(
  path: PlatformTenantControllerGetPathParams,
): string {
  return buildUrl('/platform/tenants/{id}', path);
}

// DELETE /platform/tenants/{id}

export interface PlatformTenantControllerRemovePathParams {
  id: string;
}

export interface PlatformTenantControllerRemoveInput {
  path: PlatformTenantControllerRemovePathParams;
}

export interface PlatformTenantControllerRemoveResponses {
  204: undefined;
}

export type PlatformTenantControllerRemoveResponse = PlatformTenantControllerRemoveResponses[204];

export type PlatformTenantControllerRemoveResult = ApiResponse<
  204,
  PlatformTenantControllerRemoveResponses[204]
>;

export function getPlatformTenantControllerRemoveUrl(
  path: PlatformTenantControllerRemovePathParams,
): string {
  return buildUrl('/platform/tenants/{id}', path);
}

// PATCH /platform/tenants/{id}

export interface PlatformTenantControllerUpdatePathParams {
  id: string;
}

export type PlatformTenantControllerUpdateBody = UpdateTenantRequest;

export interface PlatformTenantControllerUpdateInput {
  path: PlatformTenantControllerUpdatePathParams;
  body: PlatformTenantControllerUpdateBody;
}

export interface PlatformTenantControllerUpdateResponses {
  200: {
    data: PlatformTenant;
  };
}

export type PlatformTenantControllerUpdateResponse = PlatformTenantControllerUpdateResponses[200];

export type PlatformTenantControllerUpdateResult = ApiResponse<
  200,
  PlatformTenantControllerUpdateResponses[200]
>;

export function getPlatformTenantControllerUpdateUrl(
  path: PlatformTenantControllerUpdatePathParams,
): string {
  return buildUrl('/platform/tenants/{id}', path);
}

// GET /platform/tenants/{id}/features/{feature}/impact

export interface PlatformTenantControllerFeatureImpactPathParams {
  id: string;
  feature:
    | 'file'
    | 'auditLog'
    | 'job'
    | 'trash'
    | 'systemSetting'
    | 'identityProvider'
    | 'tenantSwitch'
    | 'webhook'
    | 'announcement'
    | 'externalApi';
}

export interface PlatformTenantControllerFeatureImpactInput {
  path: PlatformTenantControllerFeatureImpactPathParams;
}

export interface PlatformTenantControllerFeatureImpactResponses {
  200: {
    data: TenantFeatureImpact;
  };
}

export type PlatformTenantControllerFeatureImpactResponse =
  PlatformTenantControllerFeatureImpactResponses[200];

export type PlatformTenantControllerFeatureImpactResult = ApiResponse<
  200,
  PlatformTenantControllerFeatureImpactResponses[200]
>;

export function getPlatformTenantControllerFeatureImpactUrl(
  path: PlatformTenantControllerFeatureImpactPathParams,
): string {
  return buildUrl('/platform/tenants/{id}/features/{feature}/impact', path);
}

// POST /platform/tenants/{id}/provision

export interface PlatformTenantControllerRetryProvisioningPathParams {
  id: string;
}

export interface PlatformTenantControllerRetryProvisioningInput {
  path: PlatformTenantControllerRetryProvisioningPathParams;
}

export interface PlatformTenantControllerRetryProvisioningResponses {
  200: {
    data: PlatformTenant;
  };
}

export type PlatformTenantControllerRetryProvisioningResponse =
  PlatformTenantControllerRetryProvisioningResponses[200];

export type PlatformTenantControllerRetryProvisioningResult = ApiResponse<
  200,
  PlatformTenantControllerRetryProvisioningResponses[200]
>;

export function getPlatformTenantControllerRetryProvisioningUrl(
  path: PlatformTenantControllerRetryProvisioningPathParams,
): string {
  return buildUrl('/platform/tenants/{id}/provision', path);
}

// POST /platform/tenants/{id}/disable

export interface PlatformTenantControllerDisablePathParams {
  id: string;
}

export interface PlatformTenantControllerDisableInput {
  path: PlatformTenantControllerDisablePathParams;
}

export interface PlatformTenantControllerDisableResponses {
  200: {
    data: PlatformTenant;
  };
}

export type PlatformTenantControllerDisableResponse = PlatformTenantControllerDisableResponses[200];

export type PlatformTenantControllerDisableResult = ApiResponse<
  200,
  PlatformTenantControllerDisableResponses[200]
>;

export function getPlatformTenantControllerDisableUrl(
  path: PlatformTenantControllerDisablePathParams,
): string {
  return buildUrl('/platform/tenants/{id}/disable', path);
}

// POST /platform/tenants/{id}/enable

export interface PlatformTenantControllerEnablePathParams {
  id: string;
}

export interface PlatformTenantControllerEnableInput {
  path: PlatformTenantControllerEnablePathParams;
}

export interface PlatformTenantControllerEnableResponses {
  200: {
    data: PlatformTenant;
  };
}

export type PlatformTenantControllerEnableResponse = PlatformTenantControllerEnableResponses[200];

export type PlatformTenantControllerEnableResult = ApiResponse<
  200,
  PlatformTenantControllerEnableResponses[200]
>;

export function getPlatformTenantControllerEnableUrl(
  path: PlatformTenantControllerEnablePathParams,
): string {
  return buildUrl('/platform/tenants/{id}/enable', path);
}

// POST /platform/tenants/{id}/domains

export interface PlatformTenantControllerAddDomainPathParams {
  id: string;
}

export type PlatformTenantControllerAddDomainBody = AddTenantDomainRequest;

export interface PlatformTenantControllerAddDomainInput {
  path: PlatformTenantControllerAddDomainPathParams;
  body: PlatformTenantControllerAddDomainBody;
}

export interface PlatformTenantControllerAddDomainResponses {
  200: {
    data: PlatformTenant;
  };
}

export type PlatformTenantControllerAddDomainResponse =
  PlatformTenantControllerAddDomainResponses[200];

export type PlatformTenantControllerAddDomainResult = ApiResponse<
  200,
  PlatformTenantControllerAddDomainResponses[200]
>;

export function getPlatformTenantControllerAddDomainUrl(
  path: PlatformTenantControllerAddDomainPathParams,
): string {
  return buildUrl('/platform/tenants/{id}/domains', path);
}

// DELETE /platform/tenants/{id}/domains/{domain}

export interface PlatformTenantControllerRemoveDomainPathParams {
  id: string;
  domain: string;
}

export interface PlatformTenantControllerRemoveDomainInput {
  path: PlatformTenantControllerRemoveDomainPathParams;
}

export interface PlatformTenantControllerRemoveDomainResponses {
  200: {
    data: PlatformTenant;
  };
}

export type PlatformTenantControllerRemoveDomainResponse =
  PlatformTenantControllerRemoveDomainResponses[200];

export type PlatformTenantControllerRemoveDomainResult = ApiResponse<
  200,
  PlatformTenantControllerRemoveDomainResponses[200]
>;

export function getPlatformTenantControllerRemoveDomainUrl(
  path: PlatformTenantControllerRemoveDomainPathParams,
): string {
  return buildUrl('/platform/tenants/{id}/domains/{domain}', path);
}
