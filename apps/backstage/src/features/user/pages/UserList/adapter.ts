import type { TagSummary, User } from '@/shared/api-sdk';

export interface UserRowVM {
  id: string;
  email: string;
  displayName: string;
  username: string;
  status: User['status'];
  roles: Array<{ id: string; name: string; isSystem: boolean }>;
  tags: TagSummary[];
  lastLoginAt: Date | null;
  /** 有任一已設定的 MFA 驗證方式。 */
  mfaEnabled: boolean;
  createdAt: Date;
  /** 樂觀鎖版本：批次啟用／停用以它送出（docs/architecture/backend/14-revisions.md §9.2 D4）。 */
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
    tags: dto.tags,
    lastLoginAt: dto.lastLoginAt ? new Date(dto.lastLoginAt) : null,
    mfaEnabled: dto.mfaEnabled,
    createdAt: new Date(dto.createdAt),
    version: dto.version,
    isSelf,
    // 不能刪除自己（後端也會擋，這裡是體驗）
    canDelete: permission.canDelete && !isSelf,
    canUpdate: permission.canUpdate && !isSelf,
    canUnlock: permission.canUnlock && dto.status === 'locked',
  };
}
