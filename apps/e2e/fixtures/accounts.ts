export const E2E_PASSWORD = 'E2E!Password123';

export const ACCOUNTS = {
  superAdmin: 'e2e-superadmin@dev.local',
  admin: 'e2e-admin@dev.local',
  auditor: 'e2e-auditor@dev.local',
  member: 'e2e-member@dev.local',
  lockTarget: 'e2e-lockme@dev.local',
  disableTarget: 'e2e-disableme@dev.local',
  revokeTarget: 'e2e-revokeme@dev.local',
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

/**
 * apps/auth 的平台管理者（平台 DB，docs/adr/0020-physical-tenant-isolation.md D5）；與上面租戶的帳號是兩份資料。
 * 由 `db:seed:e2e` 建立，密碼同 `E2E_PASSWORD`。
 */
export const PLATFORM_ADMIN = 'e2e-platform@dev.local';
