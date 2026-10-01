import { PERMISSION } from '@/common/types';

export const GROUP_PERMISSIONS = {
  CREATE: PERMISSION.GROUP_CREATE,
  READ: PERMISSION.GROUP_READ,
  UPDATE: PERMISSION.GROUP_UPDATE,
  DELETE: PERMISSION.GROUP_DELETE,
  ASSIGN_ROLE: PERMISSION.GROUP_ASSIGN_ROLE,
} as const;

export const GROUP_AUDIT_FIELDS = ['name', 'description'] as const;

/** 一次增減成員／角色的上限（DTO 的陣列上限）。 */
export const GROUP_BATCH_LIMIT = 100;
