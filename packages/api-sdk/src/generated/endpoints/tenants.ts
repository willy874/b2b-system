// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { CurrentTenant, TenantLookup } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /tenant/current

export interface TenantControllerCurrentResponses {
  200: {
    data: CurrentTenant;
  };
}

export type TenantControllerCurrentResponse = TenantControllerCurrentResponses[200];

export type TenantControllerCurrentResult = ApiResponse<200, TenantControllerCurrentResponses[200]>;

export function getTenantControllerCurrentUrl(): string {
  return buildUrl('/tenant/current');
}

// GET /tenants/lookup

export interface TenantControllerLookupResponses {
  200: {
    data: TenantLookup;
  };
}

export type TenantControllerLookupResponse = TenantControllerLookupResponses[200];

export type TenantControllerLookupResult = ApiResponse<200, TenantControllerLookupResponses[200]>;

export function getTenantControllerLookupUrl(): string {
  return buildUrl('/tenants/lookup');
}
