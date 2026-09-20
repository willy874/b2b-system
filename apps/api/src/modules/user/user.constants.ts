import { PERMISSION } from '@/common/types';

export const USER_PERMISSIONS = {
  CREATE: PERMISSION.USER_CREATE,
  READ: PERMISSION.USER_READ,
  UPDATE: PERMISSION.USER_UPDATE,
  DELETE: PERMISSION.USER_DELETE,
  ASSIGN_ROLE: PERMISSION.USER_ASSIGN_ROLE,
  RESET_PASSWORD: PERMISSION.USER_RESET_PASSWORD,
} as const;

/** 進稽核 diff 的欄位白名單（密碼雜湊等敏感欄位永不進入）。 */
export const USER_AUDIT_FIELDS = [
  'email',
  'username',
  'displayName',
  'status',
  'locale',
  'timezone',
] as const;
