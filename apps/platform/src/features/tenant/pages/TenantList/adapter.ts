import type { PlatformTenant } from '@/shared/api-sdk';

export interface TenantRowVM {
  id: string;
  code: string;
  name: string;
  status: PlatformTenant['status'];
  /** 第一個網域是主要網域；理論上至少有一個，沒有時是 `undefined`。 */
  primaryDomain: string | undefined;
  createdAt: Date;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toTenantRowVM(dto: PlatformTenant): TenantRowVM {
  return {
    id: dto.id,
    code: dto.code,
    name: dto.name,
    status: dto.status,
    primaryDomain: dto.domains[0],
    createdAt: new Date(dto.createdAt),
  };
}
