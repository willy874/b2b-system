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

/**
 * 遞增樂觀鎖 `version` 的欄位：使用者自己可編輯的內容（管理者的編輯表單、個人資料）與狀態。
 * 登入計數、鎖定到期、密碼、`token_version`、最後登入時間是帳號的運作狀態，改了不遞增——
 * 否則每次有人登入，別人開著的編輯表單就會衝突（ADR-0025 D3）。
 */
export const USER_VERSIONED_FIELDS = [
  'username',
  'displayName',
  'status',
  'locale',
  'timezone',
] as const;
