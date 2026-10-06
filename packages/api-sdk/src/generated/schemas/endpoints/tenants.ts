// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  TenantControllerCurrentResult,
  TenantControllerLookupResult,
} from '../../endpoints/tenants';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import { CurrentTenantSchema, TenantLookupSchema } from '../components';

// GET /tenant/current

export const TenantControllerCurrentSchemas = {
  responses: {
    200: z.object({
      data: CurrentTenantSchema,
    }),
  },
} satisfies OperationSchemas;

const tenantControllerCurrentOperation: OperationDefinition = {
  id: 'TenantController_current',
  method: 'GET',
  path: '/tenant/current',
  responseTypes: { 200: 'json' },
  schemas: TenantControllerCurrentSchemas,
};

/** 目前網域的租戶（backstage 跳去登入時帶上它的代碼） */
export function tenantControllerCurrent(
  options?: RequestOptions,
): Promise<TenantControllerCurrentResult> {
  return request<TenantControllerCurrentResult>(tenantControllerCurrentOperation, {}, options);
}

// GET /tenants/lookup

export const TenantControllerLookupSchemas = {
  responses: {
    200: z.object({
      data: TenantLookupSchema,
    }),
  },
} satisfies OperationSchemas;

const tenantControllerLookupOperation: OperationDefinition = {
  id: 'TenantController_lookup',
  method: 'GET',
  path: '/tenants/lookup',
  responseTypes: { 200: 'json' },
  schemas: TenantControllerLookupSchemas,
};

/** 以代碼找租戶的登入入口（apps/platform 的進入租戶、帳號流程完成後） */
export function tenantControllerLookup(
  options?: RequestOptions,
): Promise<TenantControllerLookupResult> {
  return request<TenantControllerLookupResult>(tenantControllerLookupOperation, {}, options);
}
