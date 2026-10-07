// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  PlatformTenantControllerAddDomainInput,
  PlatformTenantControllerAddDomainResult,
  PlatformTenantControllerCreateInput,
  PlatformTenantControllerCreateResult,
  PlatformTenantControllerDisableInput,
  PlatformTenantControllerDisableResult,
  PlatformTenantControllerEnableInput,
  PlatformTenantControllerEnableResult,
  PlatformTenantControllerFeatureImpactInput,
  PlatformTenantControllerFeatureImpactResult,
  PlatformTenantControllerGetInput,
  PlatformTenantControllerGetResult,
  PlatformTenantControllerListResult,
  PlatformTenantControllerRemoveDomainInput,
  PlatformTenantControllerRemoveDomainResult,
  PlatformTenantControllerRemoveInput,
  PlatformTenantControllerRemoveResult,
  PlatformTenantControllerRetryProvisioningInput,
  PlatformTenantControllerRetryProvisioningResult,
  PlatformTenantControllerUpdateInput,
  PlatformTenantControllerUpdateResult,
} from '../../endpoints/platform-tenants';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  AddTenantDomainRequestSchema,
  CreateTenantRequestSchema,
  PlatformTenantListSchema,
  PlatformTenantSchema,
  TenantFeatureImpactSchema,
  UpdateTenantRequestSchema,
} from '../components';

// GET /platform/tenants

export const PlatformTenantControllerListSchemas = {
  responses: {
    200: z.object({
      data: PlatformTenantListSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const PlatformTenantControllerCreateSchemas = {
  body: CreateTenantRequestSchema,
  responses: {
    201: z.object({
      data: PlatformTenantSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const PlatformTenantControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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

// GET /platform/tenants/{id}/features/{feature}/impact

export const PlatformTenantControllerFeatureImpactSchemas = {
  path: z.object({
    id: z.string(),
    feature: z.enum([
      'file',
      'auditLog',
      'job',
      'trash',
      'systemSetting',
      'identityProvider',
      'tenantSwitch',
      'webhook',
      'announcement',
      'externalApi',
    ]),
  }),
  responses: {
    200: z.object({
      data: TenantFeatureImpactSchema,
    }),
  },
} satisfies OperationSchemas;

const platformTenantControllerFeatureImpactOperation: OperationDefinition = {
  id: 'PlatformTenantController_featureImpact',
  method: 'GET',
  path: '/platform/tenants/{id}/features/{feature}/impact',
  responseTypes: { 200: 'json' },
  schemas: PlatformTenantControllerFeatureImpactSchemas,
};

/** 關閉這個 feature 會影響的數量（關閉前的確認框用） */
export function platformTenantControllerFeatureImpact(
  input: PlatformTenantControllerFeatureImpactInput,
  options?: RequestOptions,
): Promise<PlatformTenantControllerFeatureImpactResult> {
  return request<PlatformTenantControllerFeatureImpactResult>(
    platformTenantControllerFeatureImpactOperation,
    input,
    options,
  );
}

// POST /platform/tenants/{id}/provision

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
