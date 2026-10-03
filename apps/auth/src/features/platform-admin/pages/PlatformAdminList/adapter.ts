import type { PlatformAdmin } from '@/shared/api-sdk';

export interface PlatformAdminRowVM {
  id: string;
  email: string;
  displayName: string;
  role: PlatformAdmin['role'];
  status: PlatformAdmin['status'];
  lastLoginAt: Date | null;
  /** 登入中的自己：後端不允許變更自己的角色與狀態（`AUTHZ_SELF_MODIFY`）。 */
  isSelf: boolean;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toPlatformAdminRowVM(
  dto: PlatformAdmin,
  currentAdminId: string | undefined,
): PlatformAdminRowVM {
  return {
    id: dto.id,
    email: dto.email,
    displayName: dto.displayName,
    role: dto.role,
    status: dto.status,
    lastLoginAt: dto.lastLoginAt ? new Date(dto.lastLoginAt) : null,
    isSelf: dto.id === currentAdminId,
  };
}

/** 關鍵字比對名稱或 email（不分大小寫）；API 不分頁，在前端篩選。 */
export function matchesPlatformAdminKeyword(
  row: PlatformAdminRowVM,
  keyword: string | undefined,
): boolean {
  if (!keyword) return true;
  const needle = keyword.toLowerCase();
  return row.displayName.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle);
}
