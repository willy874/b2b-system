import type { Group } from '@/shared/api-sdk';

export interface GroupRowVM {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  roleCount: number;
  createdAt: Date;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toGroupRowVM(dto: Group): GroupRowVM {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description || '-',
    memberCount: dto.memberCount,
    roleCount: dto.roleCount,
    createdAt: new Date(dto.createdAt),
  };
}
