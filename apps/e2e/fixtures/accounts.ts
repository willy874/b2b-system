export const E2E_PASSWORD = 'E2E!Password123';

export const ACCOUNTS = {
  superAdmin: 'e2e-superadmin@dev.local',
  admin: 'e2e-admin@dev.local',
  auditor: 'e2e-auditor@dev.local',
  member: 'e2e-member@dev.local',
  lockTarget: 'e2e-lockme@dev.local',
  disableTarget: 'e2e-disableme@dev.local',
} as const;

export type AccountKey = keyof typeof ACCOUNTS;
