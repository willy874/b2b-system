import { vi } from 'vitest';

import type { TenantContext } from '@/core/tenant';
import { runInTenantContext } from '@/core/tenant';
import type { UserRow } from '@/db/schema';
import type { RefreshTokenRecord, RefreshTokenStore } from '@/modules/credential/refresh-rotation';
import { sha256 } from '@/modules/credential/token-hash';

import { AuthService } from '../auth.service';

/** 單元測試的假交易：`withTransaction` 對非物件的 tx 不掛 afterCommit。 */
export const TX = 'tx';

export const TENANT_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';
export const USER_ID = '33333333-3333-4333-8333-333333333333';
export const ADMIN_ID = '44444444-4444-4444-8444-444444444444';

export const tenantContext = {
  id: TENANT_ID,
  code: 'acme',
  db: {} as never,
  storageBucket: 'acme',
  features: ['user', 'role'],
  flags: {},
  featureParams: {},
} as unknown as TenantContext;

export function inTenant<T>(fn: () => T, context: TenantContext = tenantContext): T {
  return runInTenantContext(context, fn);
}

export function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: USER_ID,
    email: 'alice@example.com',
    username: 'alice',
    displayName: 'Alice',
    status: 'active',
    passwordHash: 'hash:old',
    tokenVersion: 3,
    lockedUntil: null,
    failedLoginCount: 0,
    lastLoginAt: null,
    deletedAt: null,
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    avatarImageId: null,
    ...overrides,
  } as UserRow;
}

/** 依名稱取設定值的假 `SettingService`。 */
export function fakeSettings(values: Record<string, unknown>) {
  return { get: vi.fn(async (setting: { key: string }) => values[setting.key]) };
}

export const DEFAULT_ENV: Record<string, unknown> = {
  NODE_ENV: 'test',
  REFRESH_TOKEN_TTL: 1_209_600,
  REFRESH_FAMILY_MAX_AGE: 2_592_000,
  REFRESH_REUSE_GRACE_SECONDS: 10,
  JWT_ACCESS_TTL: 300,
};

export interface LoginDeps {
  users: unknown;
  userCache: unknown;
  audit: unknown;
  events: unknown;
  settings: unknown;
  passwords: unknown;
}

/** 全部依賴都是假物件的 `AuthService`；`logins` 可換成真的 `UserLoginService`。 */
export function setupAuthService(
  options: {
    env?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    /** 以假依賴建出 `logins`（例：真的 `UserLoginService`）；省略時是假物件。 */
    logins?: (deps: LoginDeps) => unknown;
  } = {},
) {
  const env = { ...DEFAULT_ENV, ...options.env };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) };
  const config = { get: vi.fn((key: string) => env[key]) };
  const tokenKeys = { sign: vi.fn(async (..._args: unknown[]) => 'signed.jwt') };
  const users = {
    findAccountById: vi.fn(async (_id: string): Promise<UserRow | undefined> => undefined),
    findAccountByEmail: vi.fn(async (_email: string): Promise<UserRow | undefined> => undefined),
    listRoleSummaries: vi.fn(async (_id: string) => [{ id: 'role-1', name: 'Member' }]),
    updateAccount: vi.fn(async (..._args: unknown[]) => undefined),
    incrementTokenVersion: vi.fn(async (..._args: unknown[]) => undefined),
    emitStatusChanged: vi.fn(async (..._args: unknown[]) => undefined),
    recordFailedLogin: vi.fn(
      async (..._args: unknown[]): Promise<{ lockedUntil: Date | null } | undefined> => ({
        lockedUntil: null,
      }),
    ),
  };
  const refreshTokens = {
    issue: vi.fn(async (..._args: unknown[]) => ({ raw: 'refresh-raw' })),
    rotate: vi.fn(),
    revokeFamilyOf: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
    revokeByIdpSession: vi.fn(async (..._args: unknown[]) => undefined),
    revokeAllForUser: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const authTokens = {
    findUsable: vi.fn(
      async (..._args: unknown[]): Promise<{ id: string; userId: string } | undefined> => undefined,
    ),
    markUsed: vi.fn(async (..._args: unknown[]) => true),
  };
  const permissionService = {
    getEffectivePermissionKeys: vi.fn(async (_id: string) => ['user:read']),
  };
  const userCache = { invalidate: vi.fn() };
  const audit = {
    record: vi.fn(async (..._args: unknown[]) => undefined),
    recordSafely: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const events = { publish: vi.fn() };
  const approvals = { submit: vi.fn(async (..._args: unknown[]) => undefined) };
  const jobs = { enqueue: vi.fn(async (..._args: unknown[]) => undefined) };
  const oidc = { destroySession: vi.fn(async (_uid: string) => undefined) };
  const identityProviders = { isSsoOnly: vi.fn(async (_email: string) => false) };
  const settings = fakeSettings({
    'auth.passwordMinLength': 12,
    'auth.registrationEnabled': true,
    'auth.loginMaxAttempts': 5,
    'auth.loginLockoutSeconds': 900,
    ...options.settings,
  });
  const flags = { enabledKeys: vi.fn(() => ['beta']) };
  const accessTokens = { verify: vi.fn() };
  const passwords = {
    verify: vi.fn(async (..._args: unknown[]) => true),
    verifyAgainstDummy: vi.fn(async (..._args: unknown[]) => false),
    hash: vi.fn(async (password: string) => `hash:${password}`),
  };
  const logins = (options.logins?.({
    users,
    userCache,
    audit,
    events,
    settings,
    passwords,
  }) as never) ?? {
    verifyPassword: vi.fn(async (..._args: unknown[]) => makeUser()),
    completeLogin: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const mfa = { isRequiredForDirectLogin: vi.fn(async (..._args: unknown[]) => false) };
  const avatars = { avatarOf: vi.fn(async (..._args: unknown[]) => null) };

  const service = new AuthService(
    db as never,
    config as never,
    tokenKeys as never,
    users as never,
    refreshTokens as never,
    authTokens as never,
    permissionService as never,
    userCache as never,
    audit as never,
    events as never,
    approvals as never,
    jobs as never,
    oidc as never,
    identityProviders as never,
    settings as never,
    flags as never,
    accessTokens as never,
    passwords as never,
    logins,
    mfa as never,
    avatars as never,
  );
  return {
    service,
    db,
    config,
    tokenKeys,
    users,
    refreshTokens,
    authTokens,
    permissionService,
    userCache,
    audit,
    events,
    approvals,
    jobs,
    oidc,
    identityProviders,
    settings,
    flags,
    accessTokens,
    passwords,
    logins: logins as unknown as {
      verifyPassword: ReturnType<typeof vi.fn>;
      completeLogin: ReturnType<typeof vi.fn>;
    },
    mfa,
  };
}

/** 記憶體裡的 refresh token 儲存，讓 `refresh()` 走真的輪替規則。 */
export function memoryRefreshStore(rows: RefreshTokenRecord[]) {
  const revokedFamilies = new Set<string>();
  const store: RefreshTokenStore = {
    findByHash: async (hash) => rows.find((row) => row.tokenHash === hash),
    isFamilyRevoked: async (familyId) => revokedFamilies.has(familyId),
    revokeFamily: vi.fn(async (familyId: string) => {
      revokedFamilies.add(familyId);
    }),
    rotate: async (row, next) => {
      row.usedAt = new Date();
      const raw = `raw-${rows.length}`;
      rows.push({
        ...row,
        id: `rt-${rows.length}`,
        tokenHash: sha256(raw),
        expiresAt: next.expiresAt,
        usedAt: null,
      });
      return raw;
    },
    supersede: async () => 'raw-superseded',
  };
  return { store, revokedFamilies };
}

export function refreshRecord(overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
  return {
    id: 'rt-0',
    subjectId: USER_ID,
    familyId: 'family-1',
    familyCreatedAt: new Date(Date.now() - 60_000),
    tokenHash: sha256('raw-0'),
    expiresAt: new Date(Date.now() + 3_600_000),
    usedAt: null,
    revokedAt: null,
    revokedReason: null,
    clientId: 'backstage',
    idpSessionUid: 'idp-1',
    ...overrides,
  };
}
