import type { ServiceAccount } from '@/shared/api-sdk';

export interface ServiceAccountRowVM {
  id: string;
  name: string;
  status: ServiceAccount['status'];
  roleNames: string;
  activeTokenCount: number;
  createdAt: Date;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toServiceAccountRowVM(dto: ServiceAccount): ServiceAccountRowVM {
  return {
    id: dto.id,
    name: dto.name,
    status: dto.status,
    roleNames: dto.roles.map((role) => role.name).join('、') || '-',
    activeTokenCount: dto.activeTokenCount,
    createdAt: new Date(dto.createdAt),
  };
}
