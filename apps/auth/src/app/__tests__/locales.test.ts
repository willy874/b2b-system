import { describe, expect, it } from 'vitest';

import { ERROR_MESSAGE_KEY } from '@/core/errors';

import enUS from '../locales/en_US.json';
import zhTW from '../locales/zh_TW.json';

/**
 * 後端的 `ErrorCode` 與 `PERMISSION_SEED` 是這兩份翻譯的來源。
 * 缺翻譯會靜默降級成通用訊息，所以用測試擋下（docs/architecture/frontend/08-i18n.md §3.1）。
 */
const ERROR_CODES = [
  'VALIDATION_FAILED',
  'TENANT_NOT_FOUND',
  'TENANT_UNAVAILABLE',
  'PLATFORM_ONLY',
  'TENANT_CODE_TAKEN',
  'TENANT_DOMAIN_TAKEN',
  'TENANT_STATUS_CONFLICT',
  'TENANT_LAST_DOMAIN',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_ACCOUNT_PENDING',
  'AUTH_ACCOUNT_DISABLED',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_STALE',
  'AUTH_REFRESH_INVALID',
  'AUTH_REFRESH_EXPIRED',
  'AUTH_REFRESH_REVOKED',
  'AUTH_REFRESH_REUSED',
  'AUTH_PASSWORD_MISMATCH',
  'AUTH_PASSWORD_WEAK',
  'AUTH_SETUP_TOKEN_INVALID',
  'AUTH_SSO_INTERACTION_INVALID',
  'AUTH_SSO_CODE_INVALID',
  'AUTH_SSO_REQUIRED',
  'AUTH_SSO_ACCOUNT_NOT_FOUND',
  'AUTH_SSO_PROVIDER_UNAVAILABLE',
  'AUTH_SSO_EXTERNAL_FAILED',
  'AUTHZ_FORBIDDEN',
  'AUTHZ_ESCALATION',
  'AUTHZ_SELF_MODIFY',
  'ROUTE_PERMISSION_NOT_DECLARED',
  'USER_NOT_FOUND',
  'USER_EMAIL_DUPLICATE',
  'USER_USERNAME_DUPLICATE',
  'USER_NOT_LOCKED',
  'ROLE_NOT_FOUND',
  'ROLE_NAME_DUPLICATE',
  'ROLE_SYSTEM_PROTECTED',
  'ROLE_SUPER_ADMIN_IMMUTABLE',
  'ROLE_IN_USE',
  'LAST_SUPER_ADMIN',
  'PERMISSION_UNKNOWN',
  'APPROVAL_NOT_FOUND',
  'APPROVAL_ALREADY_REVIEWED',
  'APPROVAL_SELF_REVIEW',
  'IDENTITY_PROVIDER_NOT_FOUND',
  'IDENTITY_PROVIDER_NAME_DUPLICATE',
  'IDENTITY_PROVIDER_DOMAIN_TAKEN',
  'JOB_NOT_FOUND',
  'JOB_NOT_RETRYABLE',
  'FILE_NOT_FOUND',
  'FILE_TOO_LARGE',
  'FILE_ALREADY_UPLOADED',
  'FILE_UPLOAD_INCOMPLETE',
  'FILE_SIZE_MISMATCH',
  'FILE_STORAGE_UNAVAILABLE',
  'FILE_UPLOAD_PART_INVALID',
  'FILE_VERSION_CONFLICT',
  'FILE_IMAGE_URL_INVALID',
  'FILE_FOLDER_NOT_FOUND',
  'FILE_FOLDER_NAME_CONFLICT',
  'FILE_FOLDER_CYCLE',
  'FILE_GRANT_SUBJECT_NOT_FOUND',
  'FILE_GRANT_NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
];

const PERMISSION_KEYS = [
  ['user', 'create'],
  ['user', 'read'],
  ['user', 'update'],
  ['user', 'delete'],
  ['user', 'assignRole'],
  ['user', 'resetPassword'],
  ['role', 'create'],
  ['role', 'read'],
  ['role', 'update'],
  ['role', 'delete'],
  ['role', 'grantPermission'],
  ['permission', 'read'],
  ['auditLog', 'read'],
  ['system', 'read'],
  ['system', 'update'],
  ['approval', 'read'],
  ['approval', 'review'],
  ['file', 'create'],
  ['file', 'read'],
  ['file', 'update'],
  ['file', 'delete'],
  ['identityProvider', 'create'],
  ['identityProvider', 'read'],
  ['identityProvider', 'update'],
  ['identityProvider', 'delete'],
  // 平台的權限目錄（docs/rbac/02-permission-catalog.md §8）：apps/auth 的頁面實際用到的是這幾個
  ['tenant', 'read'],
  ['tenant', 'create'],
  ['tenant', 'update'],
  ['tenant', 'delete'],
] as const;

const bundles = { zh_TW: zhTW, en_US: enUS } as Record<string, Record<string, unknown>>;

function lookup(bundle: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>(
    (value, key) => (value as Record<string, unknown> | undefined)?.[key],
    bundle,
  );
}

describe('語系檔完整性', () => {
  for (const [name, bundle] of Object.entries(bundles)) {
    it(`${name}：每個 ErrorCode 都有翻譯`, () => {
      const missing = ERROR_CODES.filter((code) => !lookup(bundle, ['error', code]));
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });

    it(`${name}：ERROR_MESSAGE_KEY 的每個語系鍵都有翻譯`, () => {
      const missing = Object.values(ERROR_MESSAGE_KEY).filter(
        (key) => !lookup(bundle, key.split('.')),
      );
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });

    it(`${name}：每個權限都有顯示名稱`, () => {
      const missing = PERMISSION_KEYS.filter(
        ([resource, action]) => !lookup(bundle, ['permission', resource, action]),
      ).map(([resource, action]) => `${resource}:${action}`);
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });

    it(`${name}：每個資源都有分組名稱`, () => {
      const resources = [...new Set(PERMISSION_KEYS.map(([resource]) => resource))];
      const missing = resources.filter(
        (resource) => !lookup(bundle, ['permission', 'resource', resource]),
      );
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });
  }

  it('ERROR_MESSAGE_KEY 涵蓋每個 ErrorCode，且不多不少', () => {
    expect(new Set(Object.keys(ERROR_MESSAGE_KEY))).toEqual(new Set(ERROR_CODES));
  });

  it('兩個語系的鍵集合一致', () => {
    const flatten = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) =>
            flatten(child, prefix ? `${prefix}.${key}` : key),
          )
        : [prefix];

    expect(new Set(flatten(zhTW))).toEqual(new Set(flatten(enUS)));
  });
});
