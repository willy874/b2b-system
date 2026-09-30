import type { User } from '@/shared/api-sdk';

export interface UserRowVM {
  id: string;
  email: string;
  displayName: string;
  username: string;
  status: User['status'];
  roles: Array<{ id: string; name: string; isSystem: boolean }>;
  lastLoginAt: Date | null;
  createdAt: Date;
  /** 樂觀鎖版本：批次啟用／停用以它送出（ADR-0025 D4）。 */
  version: number;
  isSelf: boolean;
  canDelete: boolean;
  canUpdate: boolean;
  canUnlock: boolean;
}

export interface UserPermissionFacade {
  canDelete: boolean;
  canUpdate: boolean;
  canUnlock: boolean;
}

export function toUserRowVM(
  dto: User,
  permission: UserPermissionFacade,
  currentUserId: string | undefined,
): UserRowVM {
  const isSelf = dto.id === currentUserId;
  return {
    id: dto.id,
    email: dto.email,
    displayName: dto.displayName,
    username: dto.username ?? '-',
    status: dto.status,
    roles: dto.roles,
    lastLoginAt: dto.lastLoginAt ? new Date(dto.lastLoginAt) : null,
    createdAt: new Date(dto.createdAt),
    version: dto.version,
    isSelf,
    // 不能刪除自己（後端也會擋，這裡是體驗）
    canDelete: permission.canDelete && !isSelf,
    canUpdate: permission.canUpdate && !isSelf,
    canUnlock: permission.canUnlock && dto.status === 'locked',
  };
}
