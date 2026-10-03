import type { PlatformProfile } from '@/shared/api-sdk';

type PlatformRole = PlatformProfile['admin']['role'];

/** 鈴鐺徽章最多顯示到這個數字，超過顯示「99+」。 */
export const NOTIFICATION_BADGE_MAX = 99;

/** 鈴鐺的面板列出最近幾則。 */
export const NOTIFICATION_PANEL_LIMIT = 10;

export const NOTIFICATION_PAGE_SIZE_OPTIONS = [20, 50, 100];

/**
 * 後端的通知類型（`platform-notification.constants.ts` 的 `PlatformNotificationType`）→ 句子。
 * 已發出的類型不改名；不認得的類型（後端比前端新）顯示通用的句子。
 */
export const NOTIFICATION_MESSAGE_KEY: Readonly<Record<string, string>> = {
  'tenant.provisioned': 'notification.type.tenantProvisioned',
  'tenant.provisionFailed': 'notification.type.tenantProvisionFailed',
  'platformAdmin.roleChanged': 'notification.type.platformAdminRoleChanged',
};

export const NOTIFICATION_UNKNOWN_KEY = 'notification.type.unknown';

export const NOTIFICATION_ROLE_LABEL_KEY = {
  'super-admin': 'notification.role.superAdmin',
  operator: 'notification.role.operator',
  auditor: 'notification.role.auditor',
} as const satisfies Record<PlatformRole, string>;
