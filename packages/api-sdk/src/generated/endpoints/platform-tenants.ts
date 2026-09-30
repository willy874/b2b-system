// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  AddTenantDomainRequest,
  CreateTenantRequest,
  PlatformTenant,
  PlatformTenantList,
  UpdateTenantRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  AddTenantDomainRequestSchema,
  CreateTenantRequestSchema,
  PlatformTenantListSchema,
  PlatformTenantSchema,
  UpdateTenantRequestSchema,
} from '../schemas';

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

export const PlatformTenantControllerListSchemas = {
  responses: {
    200: z.object({
      data: PlatformTenantListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformTenantControllerListUrl(): string {
  return buildUrl('/platform/tenants');
}

const platformTenantControllerListOperation: OperationDefinition = {
  id: 'PlatformTenantController_list',
  method: 'GET',
  path: '/platform/tenants',
  responseTypes: { 200: 'json' },
  schemas: PlatformTenantControllerListSchemas,
};

/** 租戶（未刪除）與預設網域的上層；分頁、代碼／名稱／網域搜尋（q）、狀態篩選（status） */
export function platformTenantControllerList(
  options?: RequestOptions,
): Promise<PlatformTenantControllerListResult> {
  return request<PlatformTenantControllerListResult>(
    platformTenantControllerListOperation,
    {},
    options,
  );
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

export const PlatformTenantControllerCreateSchemas = {
  body: CreateTenantRequestSchema,
  responses: {
    201: z.object({
      data: PlatformTenantSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformTenantControllerCreateUrl(): string {
  return buildUrl('/platform/tenants');
}

const platformTenantControllerCreateOperation: OperationDefinition = {
  id: 'PlatformTenantController_create',
  method: 'POST',
  path: '/platform/tenants',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: PlatformTenantControllerCreateSchemas,
};

/** 建立租戶：登記後由背景工作佈建（database、migration、第一位管理員與啟用信） */
export function platformTenantControllerCreate(
  input: PlatformTenantControllerCreateInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerCreateResult> {
  return request<PlatformTenantControllerCreateResult>(
    platformTenantControllerCreateOperation,
    input,
    options,
  );
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

export const PlatformTenantControllerGetSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: PlatformTenantSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformTenantControllerGetUrl(
  path: PlatformTenantControllerGetPathParams,
): string {
  return buildUrl('/platform/tenants/{id}', path);
}

const platformTenantControllerGetOperation: OperationDefinition = {
  id: 'PlatformTenantController_get',
  method: 'GET',
  path: '/platform/tenants/{id}',
  responseTypes: { 200: 'json' },
  schemas: PlatformTenantControllerGetSchemas,
};

export function platformTenantControllerGet(
  input: PlatformTenantControllerGetInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerGetResult> {
  return request<PlatformTenantControllerGetResult>(
    platformTenantControllerGetOperation,
    input,
    options,
  );
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

export const PlatformTenantControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getPlatformTenantControllerRemoveUrl(
  path: PlatformTenantControllerRemovePathParams,
): string {
  return buildUrl('/platform/tenants/{id}', path);
}

const platformTenantControllerRemoveOperation: OperationDefinition = {
  id: 'PlatformTenantController_remove',
  method: 'DELETE',
  path: '/platform/tenants/{id}',
  responseTypes: { 204: 'none' },
  schemas: PlatformTenantControllerRemoveSchemas,
};

/** 標記刪除並停用、釋出網域；database 與 bucket 由手動步驟清除 */
export function platformTenantControllerRemove(
  input: PlatformTenantControllerRemoveInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerRemoveResult> {
  return request<PlatformTenantControllerRemoveResult>(
    platformTenantControllerRemoveOperation,
    input,
    options,
  );
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

export const PlatformTenantControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateTenantRequestSchema,
  responses: {
    200: z.object({
      data: PlatformTenantSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformTenantControllerUpdateUrl(
  path: PlatformTenantControllerUpdatePathParams,
): string {
  return buildUrl('/platform/tenants/{id}', path);
}

const platformTenantControllerUpdateOperation: OperationDefinition = {
  id: 'PlatformTenantController_update',
  method: 'PATCH',
  path: '/platform/tenants/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformTenantControllerUpdateSchemas,
};

export function platformTenantControllerUpdate(
  input: PlatformTenantControllerUpdateInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerUpdateResult> {
  return request<PlatformTenantControllerUpdateResult>(
    platformTenantControllerUpdateOperation,
    input,
    options,
  );
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

export const PlatformTenantControllerRetryProvisioningSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: PlatformTenantSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformTenantControllerRetryProvisioningUrl(
  path: PlatformTenantControllerRetryProvisioningPathParams,
): string {
  return buildUrl('/platform/tenants/{id}/provision', path);
}

const platformTenantControllerRetryProvisioningOperation: OperationDefinition = {
  id: 'PlatformTenantController_retryProvisioning',
  method: 'POST',
  path: '/platform/tenants/{id}/provision',
  responseTypes: { 200: 'json' },
  schemas: PlatformTenantControllerRetryProvisioningSchemas,
};

/** 重試失敗的佈建 */
export function platformTenantControllerRetryProvisioning(
  input: PlatformTenantControllerRetryProvisioningInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerRetryProvisioningResult> {
  return request<PlatformTenantControllerRetryProvisioningResult>(
    platformTenantControllerRetryProvisioningOperation,
    input,
    options,
  );
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

export const PlatformTenantControllerDisableSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: PlatformTenantSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformTenantControllerDisableUrl(
  path: PlatformTenantControllerDisablePathParams,
): string {
  return buildUrl('/platform/tenants/{id}/disable', path);
}

const platformTenantControllerDisableOperation: OperationDefinition = {
  id: 'PlatformTenantController_disable',
  method: 'POST',
  path: '/platform/tenants/{id}/disable',
  responseTypes: { 200: 'json' },
  schemas: PlatformTenantControllerDisableSchemas,
};

/** 停用：網域回 503，撤銷所有 session */
export function platformTenantControllerDisable(
  input: PlatformTenantControllerDisableInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerDisableResult> {
  return request<PlatformTenantControllerDisableResult>(
    platformTenantControllerDisableOperation,
    input,
    options,
  );
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

export const PlatformTenantControllerEnableSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: PlatformTenantSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformTenantControllerEnableUrl(
  path: PlatformTenantControllerEnablePathParams,
): string {
  return buildUrl('/platform/tenants/{id}/enable', path);
}

const platformTenantControllerEnableOperation: OperationDefinition = {
  id: 'PlatformTenantController_enable',
  method: 'POST',
  path: '/platform/tenants/{id}/enable',
  responseTypes: { 200: 'json' },
  schemas: PlatformTenantControllerEnableSchemas,
};

export function platformTenantControllerEnable(
  input: PlatformTenantControllerEnableInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerEnableResult> {
  return request<PlatformTenantControllerEnableResult>(
    platformTenantControllerEnableOperation,
    input,
    options,
  );
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

export const PlatformTenantControllerAddDomainSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: AddTenantDomainRequestSchema,
  responses: {
    200: z.object({
      data: PlatformTenantSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformTenantControllerAddDomainUrl(
  path: PlatformTenantControllerAddDomainPathParams,
): string {
  return buildUrl('/platform/tenants/{id}/domains', path);
}

const platformTenantControllerAddDomainOperation: OperationDefinition = {
  id: 'PlatformTenantController_addDomain',
  method: 'POST',
  path: '/platform/tenants/{id}/domains',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformTenantControllerAddDomainSchemas,
};

export function platformTenantControllerAddDomain(
  input: PlatformTenantControllerAddDomainInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerAddDomainResult> {
  return request<PlatformTenantControllerAddDomainResult>(
    platformTenantControllerAddDomainOperation,
    input,
    options,
  );
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

export const PlatformTenantControllerRemoveDomainSchemas = {
  path: z.object({
    id: z.string(),
    domain: z.string(),
  }),
  responses: {
    200: z.object({
      data: PlatformTenantSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformTenantControllerRemoveDomainUrl(
  path: PlatformTenantControllerRemoveDomainPathParams,
): string {
  return buildUrl('/platform/tenants/{id}/domains/{domain}', path);
}

const platformTenantControllerRemoveDomainOperation: OperationDefinition = {
  id: 'PlatformTenantController_removeDomain',
  method: 'DELETE',
  path: '/platform/tenants/{id}/domains/{domain}',
  responseTypes: { 200: 'json' },
  schemas: PlatformTenantControllerRemoveDomainSchemas,
};

export function platformTenantControllerRemoveDomain(
  input: PlatformTenantControllerRemoveDomainInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerRemoveDomainResult> {
  return request<PlatformTenantControllerRemoveDomainResult>(
    platformTenantControllerRemoveDomainOperation,
    input,
    options,
  );
}
