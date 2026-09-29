import type { Role } from '@/shared/api-sdk';

export interface RoleRowVM {
  id: string;
  slug: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissionCount: number;
  userCount: number;
  createdAt: Date;
  /** 已套用業務規則的衍生旗標 */
  canDelete: boolean;
  canEdit: boolean;
}

export interface RolePermissionFacade {
  canDelete: boolean;
  canUpdate: boolean;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toRoleRowVM(dto: Role, permission: RolePermissionFacade): RoleRowVM {
  return {
    id: dto.id,
    slug: dto.slug,
    name: dto.name,
    description: dto.description || '-',
    isSystem: dto.isSystem,
    permissionCount: dto.permissionCount,
    userCount: dto.userCount,
    createdAt: new Date(dto.createdAt),
    canDelete: permission.canDelete && !dto.isSystem,
    canEdit: permission.canUpdate && !dto.isSystem,
  };
}
