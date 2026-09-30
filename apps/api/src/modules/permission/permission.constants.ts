import { PERMISSION } from '@/common/types';

export const PERMISSION_MODULE_PERMISSIONS = {
  READ: PERMISSION.PERMISSION_READ,
} as const;

export const SUPER_ADMIN_SLUG = 'super-admin';

/** 一般成員：唯一不帶管理能力的系統角色（外部 IdP 只會自動連結沒有其他系統角色的帳號，docs/architecture/04-sso.md §3.3）。 */
export const MEMBER_SLUG = 'member';
