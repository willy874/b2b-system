import type { PlatformTenant } from '@/shared/api-sdk';

/** 概覽分頁的基本資料。 */
export interface TenantOverviewVM {
  code: string;
  adminEmail: string | null;
  storageBucket: string;
  createdAt: Date;
  /** 還沒佈建完成時是 `null`。 */
  provisionedAt: Date | null;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toTenantOverviewVM(dto: PlatformTenant): TenantOverviewVM {
  return {
    code: dto.code,
    adminEmail: dto.adminEmail,
    storageBucket: dto.storageBucket,
    createdAt: new Date(dto.createdAt),
    provisionedAt: dto.provisionedAt ? new Date(dto.provisionedAt) : null,
  };
}
