import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseToken, tokenPrefix } from '@/common/auth';
import type { AuthUser, PermissionKey } from '@/common/types';
import { SUPER_ADMIN_RELATION, TENANT_OBJECT } from '@/core/authz';
import type { RelationRef } from '@/core/authz';
import type { ApiTokenCacheService, PermissionSet } from '@/core/cache';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import { runWithRequestContext } from '@/core/http';
import { RESOURCE_TYPE } from '@/core/resource';
import type { SettingService } from '@/core/settings';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import type { ApiTokenRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import { sha256 } from '@/modules/credential/token-hash';
import type { PermissionService } from '@/modules/permission/permission.service';

import { API_TOKEN_MAX_ACTIVE_PER_ACCOUNT } from '../api-token.constants';
import type {
  ApiTokenRepository,
  ApiTokenWithCreator,
  TokenAccount,
} from '../api-token.repository';
import { ApiTokenService } from '../api-token.service';
import {
  PERSONAL_TOKEN_MAX_DAYS_SETTING,
  SERVICE_ACCOUNT_TOKEN_MAX_DAYS_SETTING,
} from '../api-token.settings';
import type { CreateApiTokenDto } from '../dto/api-token.dto';

const NOW = new Date('2026-10-06T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const ALICE_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const SERVICE_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN_ID = '44444444-4444-4444-8444-444444444444';

const ALICE = { id: ALICE_ID, email: 'alice@example.com' } as AuthUser;
const ADMIN = { id: ADMIN_ID, email: 'admin@example.com' } as AuthUser;

function account(overrides: Partial<TokenAccount> = {}): TokenAccount {
  return {
    id: ALICE_ID,
    kind: 'human',
    status: 'active',
    tokenVersion: 3,
    email: 'alice@example.com',
    displayName: 'Alice',
    ...overrides,
  };
}

const SERVICE_ACCOUNT = account({
  id: SERVICE_ID,
  kind: 'service',
  email: 'svc@service.invalid',
  displayName: 'CI bot',
});

function tokenRow(overrides: Partial<ApiTokenWithCreator> = {}): ApiTokenWithCreator {
  return {
    id: TOKEN_ID,
    userId: ALICE_ID,
    name: 'CI',
    prefix: 'b2bt_acme_abc_wxyz',
    secretHash: 'hash',
    scopes: null,
    accountVersion: 3,
    expiresAt: new Date(NOW.getTime() + 30 * DAY_MS),
    lastUsedAt: null,
    revokedAt: null,
    revokedBy: null,
    createdAt: new Date(NOW.getTime() - DAY_MS),
    createdBy: ALICE_ID,
    creator: { id: ALICE_ID, displayName: 'Alice' },
    ...overrides,
  };
}

function permissionSet(keys: PermissionKey[], isSuperAdmin = false): PermissionSet {
  return { permissions: new Set(keys), isSuperAdmin };
}

function setup() {
  /** 依呼叫順序記下有副作用的步驟，用來驗證交易內外的順序。 */
  const order: string[] = [];
  const tx = { tx: true };
  const db = {
    transaction: vi.fn(async (fn: (t: unknown) => unknown) => {
      order.push('tx:begin');
      const result = await fn(tx);
      order.push('tx:commit');
      return result;
    }),
  };
  const accounts = new Map<string, TokenAccount>([
    [ALICE_ID, account()],
    [SERVICE_ID, SERVICE_ACCOUNT],
  ]);
  let inserted: ApiTokenRow | undefined;
  const repo = {
    findAccount: vi.fn(async (userId: string) => accounts.get(userId)),
    list: vi.fn(async (_userId: string): Promise<ApiTokenWithCreator[]> => []),
    findOne: vi.fn(
      async (_userId: string, _tokenId: string): Promise<ApiTokenWithCreator | undefined> =>
        inserted ? { ...inserted, creator: { id: ADMIN_ID, displayName: 'Admin' } } : tokenRow(),
    ),
    countActive: vi.fn(async (_userId: string, _now: Date, _tx: unknown) => 0),
    insert: vi.fn(
      async (values: Omit<ApiTokenRow, 'lastUsedAt' | 'revokedAt' | 'revokedBy' | 'createdAt'>) => {
        order.push('repo:insert');
        inserted = {
          ...values,
          lastUsedAt: null,
          revokedAt: null,
          revokedBy: null,
          createdAt: NOW,
        };
        return inserted;
      },
    ),
    revoke: vi.fn(async (_userId: string, tokenId: string, actorId: string, _tx: unknown) => {
      order.push('repo:revoke');
      return tokenRow({ id: tokenId, revokedAt: NOW, revokedBy: actorId }) as
        | ApiTokenRow
        | undefined;
    }),
    revokeAll: vi.fn(async (_userId: string, _actorId: string, _tx: unknown) => 4),
  };
  const permissions = {
    getPermissionSet: vi.fn(async (_userId: string) => permissionSet([])),
    assertCanGrant: vi.fn(async (_actorId: string, _targets: readonly RelationRef[]) => {
      order.push('permissions:assertCanGrant');
    }),
    getEffectivePermissionKeys: vi.fn(async (): Promise<PermissionKey[]> => ['role:read']),
  };
  const settings = {
    get: vi.fn(async (definition: { key: string }): Promise<number> =>
      definition.key === PERSONAL_TOKEN_MAX_DAYS_SETTING.key ? 90 : 365,
    ),
  };
  const audit = {
    record: vi.fn(async (_entry: Record<string, unknown>, _tx: unknown) => {
      order.push('audit:record');
    }),
  };
  const cache = {
    invalidate: vi.fn((_ids: readonly string[]) => {
      order.push('cache:invalidate');
    }),
  };
  const events = {
    publish: vi.fn((_name: string, _payload: unknown) => {
      order.push('events:publish');
    }),
  };
  const service = new ApiTokenService(
    db as unknown as Database,
    repo as unknown as ApiTokenRepository,
    permissions as unknown as PermissionService,
    settings as unknown as SettingService,
    audit as unknown as AuditService,
    cache as unknown as ApiTokenCacheService,
    events as unknown as DomainEventBus,
  );
  return { service, db, repo, permissions, settings, audit, cache, events, tx, order, accounts };
}

function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenantContext({ id: 't1', code: 'acme' } as unknown as TenantContext, fn);
}

async function expectCode(promise: Promise<unknown>, code: string, details?: object) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
  if (details) expect((error as AppException).details).toEqual(details);
}

function dto(overrides: Partial<CreateApiTokenDto> = {}): CreateApiTokenDto {
  return { name: 'CI', expiresInDays: 30, ...overrides };
}

/** `assertCanGrant` 收到的權限鍵（租戶層的關係），排序後比較。 */
function grantedRelations(ctx: ReturnType<typeof setup>): string[] {
  const targets = ctx.permissions.assertCanGrant.mock.calls[0]?.[1] ?? [];
  for (const target of targets) expect(target.object).toEqual(TENANT_OBJECT);
  return targets.map((target) => target.relation).toSorted();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ApiTokenService.requireAccount（docs/architecture/06-external-api.md §9.2 D2）', () => {
  it('帳號存在且種類相符：回傳帳號', async () => {
    const ctx = setup();
    await expect(
      ctx.service.requireAccount(SERVICE_ID, 'service', 'SERVICE_ACCOUNT_NOT_FOUND'),
    ).resolves.toEqual(SERVICE_ACCOUNT);
  });

  it('帳號不存在（或已刪除）：以呼叫端給的錯誤碼回應', async () => {
    const ctx = setup();
    await expectCode(
      ctx.service.requireAccount('missing', 'service', 'SERVICE_ACCOUNT_NOT_FOUND'),
      'SERVICE_ACCOUNT_NOT_FOUND',
    );
  });

  it('服務帳號的 id 不能當使用者：種類不符回 USER_NOT_FOUND', async () => {
    const ctx = setup();
    await expectCode(
      ctx.service.requireAccount(SERVICE_ID, 'human', 'USER_NOT_FOUND'),
      'USER_NOT_FOUND',
    );
  });

  it('使用者的 id 不能當服務帳號：種類不符回 SERVICE_ACCOUNT_NOT_FOUND', async () => {
    const ctx = setup();
    await expectCode(
      ctx.service.requireAccount(ALICE_ID, 'service', 'SERVICE_ACCOUNT_NOT_FOUND'),
      'SERVICE_ACCOUNT_NOT_FOUND',
    );
  });
});

/** 列表裡一把 token 的狀態。 */
async function statusOf(overrides: Partial<ApiTokenWithCreator>) {
  const ctx = setup();
  ctx.repo.list.mockResolvedValue([tokenRow(overrides)]);
  const [item] = await ctx.service.list(account());
  return item?.status;
}

describe('ApiTokenService.list（狀態由欄位算出，docs/architecture/06-external-api.md §9.2 D5、D8）', () => {
  it('未撤銷、版本相同、未到期：active', async () => {
    expect(await statusOf({})).toBe('active');
  });

  it('已撤銷：revoked（即使同時過期、版本也變了）', async () => {
    expect(await statusOf({ revokedAt: NOW, accountVersion: 1, expiresAt: new Date(0) })).toBe(
      'revoked',
    );
  });

  it('帳號的 token_version 變了：invalidated（優先於過期）', async () => {
    expect(await statusOf({ accountVersion: 2, expiresAt: new Date(0) })).toBe('invalidated');
  });

  it('到期時間正好是現在：expired', async () => {
    expect(await statusOf({ expiresAt: NOW })).toBe('expired');
  });

  it('到期時間在現在之後一毫秒：仍是 active', async () => {
    expect(await statusOf({ expiresAt: new Date(NOW.getTime() + 1) })).toBe('active');
  });

  it('回傳的欄位：時間轉 ISO 字串，不含 secret 雜湊', async () => {
    const ctx = setup();
    ctx.repo.list.mockResolvedValue([tokenRow({ lastUsedAt: NOW, revokedAt: NOW })]);
    const [item] = await ctx.service.list(account());
    expect(item).toEqual({
      id: TOKEN_ID,
      name: 'CI',
      prefix: 'b2bt_acme_abc_wxyz',
      scopes: null,
      status: 'revoked',
      expiresAt: new Date(NOW.getTime() + 30 * DAY_MS).toISOString(),
      lastUsedAt: NOW.toISOString(),
      revokedAt: NOW.toISOString(),
      createdAt: new Date(NOW.getTime() - DAY_MS).toISOString(),
      createdBy: { id: ALICE_ID, displayName: 'Alice' },
    });
    expect(item).not.toHaveProperty('secretHash');
  });

  it('目錄已移除的權限鍵在讀取時濾掉', async () => {
    const ctx = setup();
    ctx.repo.list.mockResolvedValue([tokenRow({ scopes: ['role:read', 'legacy:gone'] })]);
    const [item] = await ctx.service.list(account());
    expect(item?.scopes).toEqual(['role:read']);
  });

  it('建立者已被硬刪除：createdBy 是 null', async () => {
    const ctx = setup();
    ctx.repo.list.mockResolvedValue([tokenRow({ creator: null })]);
    const [item] = await ctx.service.list(account());
    expect(item?.createdBy).toBeNull();
  });
});

describe('ApiTokenService 的個人 token 入口（docs/architecture/06-external-api.md §9.2 D2）', () => {
  it('listMine：列出本人的 token', async () => {
    const ctx = setup();
    ctx.repo.list.mockResolvedValue([tokenRow()]);
    const result = await ctx.service.listMine(ALICE);
    expect(ctx.repo.list).toHaveBeenCalledWith(ALICE_ID);
    expect(result.items.map((item) => item.id)).toEqual([TOKEN_ID]);
  });

  it('listMine：本人的帳號已不存在 → USER_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.accounts.delete(ALICE_ID);
    await expectCode(ctx.service.listMine(ALICE), 'USER_NOT_FOUND');
  });

  it('listForUser：服務帳號的 id → USER_NOT_FOUND，不列出它的 token', async () => {
    const ctx = setup();
    await expectCode(ctx.service.listForUser(SERVICE_ID), 'USER_NOT_FOUND');
    expect(ctx.repo.list).not.toHaveBeenCalled();
  });

  it('createMine：服務帳號以自己的 id 呼叫個人端點 → USER_NOT_FOUND', async () => {
    const ctx = setup();
    const service = { id: SERVICE_ID, email: 'svc@service.invalid' } as AuthUser;
    await expectCode(
      inTenant(() => ctx.service.createMine(service, dto())),
      'USER_NOT_FOUND',
    );
    expect(ctx.repo.insert).not.toHaveBeenCalled();
  });

  it('revokeMine：撤銷的對象限定本人的 token，撤銷者是本人', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.revokeMine(ALICE, TOKEN_ID));
    expect(ctx.repo.revoke).toHaveBeenCalledWith(ALICE_ID, TOKEN_ID, ALICE_ID, ctx.tx);
  });

  it('revokeForUser：撤銷的對象限定那位使用者的 token，撤銷者是管理者', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.revokeForUser(ALICE_ID, TOKEN_ID, ADMIN));
    expect(ctx.repo.revoke).toHaveBeenCalledWith(ALICE_ID, TOKEN_ID, ADMIN_ID, ctx.tx);
  });

  it('revokeForUser：服務帳號的 id → USER_NOT_FOUND，不撤銷', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.revokeForUser(SERVICE_ID, TOKEN_ID, ADMIN)),
      'USER_NOT_FOUND',
    );
    expect(ctx.repo.revoke).not.toHaveBeenCalled();
  });
});

describe('ApiTokenService.create 的到期上限（docs/architecture/06-external-api.md §9.2 D8）', () => {
  it('個人 token 讀個人的上限設定', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    expect(ctx.settings.get).toHaveBeenCalledWith(PERSONAL_TOKEN_MAX_DAYS_SETTING);
  });

  it('服務帳號的 token 讀服務帳號的上限設定', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(SERVICE_ACCOUNT, dto({ expiresInDays: 365 }), ADMIN));
    expect(ctx.settings.get).toHaveBeenCalledWith(SERVICE_ACCOUNT_TOKEN_MAX_DAYS_SETTING);
  });

  it('天數等於上限：可以建立', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(account(), dto({ expiresInDays: 90 }), ALICE));
    expect(ctx.repo.insert).toHaveBeenCalledTimes(1);
  });

  it('超過上限 → API_TOKEN_LIFETIME_EXCEEDED，details 帶上限，不開交易', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.create(account(), dto({ expiresInDays: 91 }), ALICE)),
      'API_TOKEN_LIFETIME_EXCEEDED',
      { maxDays: 90 },
    );
    expect(ctx.db.transaction).not.toHaveBeenCalled();
  });

  it('租戶把上限調短：以租戶設定為準', async () => {
    const ctx = setup();
    ctx.settings.get.mockResolvedValue(7);
    await expectCode(
      inTenant(() => ctx.service.create(account(), dto({ expiresInDays: 8 }), ALICE)),
      'API_TOKEN_LIFETIME_EXCEEDED',
      { maxDays: 7 },
    );
  });

  it('到期時間＝現在＋天數', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(account(), dto({ expiresInDays: 30 }), ALICE));
    expect(ctx.repo.insert.mock.calls[0]?.[0].expiresAt).toEqual(
      new Date(NOW.getTime() + 30 * DAY_MS),
    );
  });
});

describe('ApiTokenService.create 的有效 token 數上限（docs/architecture/06-external-api.md §9.2 D8）', () => {
  it(`已有 ${API_TOKEN_MAX_ACTIVE_PER_ACCOUNT - 1} 把有效 token：還能再建立一把`, async () => {
    const ctx = setup();
    ctx.repo.countActive.mockResolvedValue(API_TOKEN_MAX_ACTIVE_PER_ACCOUNT - 1);
    await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    expect(ctx.repo.insert).toHaveBeenCalledTimes(1);
  });

  it('達到上限 → API_TOKEN_LIMIT_REACHED，details 帶上限，不寫入、不記稽核、不推播', async () => {
    const ctx = setup();
    ctx.repo.countActive.mockResolvedValue(API_TOKEN_MAX_ACTIVE_PER_ACCOUNT);
    await expectCode(
      inTenant(() => ctx.service.create(account(), dto(), ALICE)),
      'API_TOKEN_LIMIT_REACHED',
      { max: API_TOKEN_MAX_ACTIVE_PER_ACCOUNT },
    );
    expect(ctx.repo.insert).not.toHaveBeenCalled();
    expect(ctx.audit.record).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('計數在交易內、以現在的時間算（已過期的不算）', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    expect(ctx.repo.countActive).toHaveBeenCalledWith(ALICE_ID, NOW, ctx.tx);
  });
});

describe('ApiTokenService.create 的寫入內容（docs/architecture/06-external-api.md §9.2 D7）', () => {
  it('回傳的 token 是 b2bt_<租戶代碼>_<id>_<secret>，id 與寫入的列相同', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    const parsed = parseToken(result.token);
    const values = ctx.repo.insert.mock.calls[0]?.[0];
    expect(parsed?.tenantCode).toBe('acme');
    expect(parsed?.tokenId).toBe(values?.id);
  });

  it('資料庫只存 secret 的 SHA-256，不存原文', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    const secret = parseToken(result.token)?.secret ?? '';
    const values = ctx.repo.insert.mock.calls[0]?.[0];
    expect(values?.secretHash).toBe(sha256(secret));
    expect(JSON.stringify(values)).not.toContain(secret);
  });

  it('prefix 是 token 開頭到 secret 的前 4 碼', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    expect(ctx.repo.insert.mock.calls[0]?.[0].prefix).toBe(tokenPrefix(result.token));
  });

  it('記下帳號目前的 token_version、擁有者與建立者', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(SERVICE_ACCOUNT, dto({ name: 'deploy' }), ADMIN));
    expect(ctx.repo.insert.mock.calls[0]?.[0]).toMatchObject({
      userId: SERVICE_ID,
      name: 'deploy',
      accountVersion: SERVICE_ACCOUNT.tokenVersion,
      createdBy: ADMIN_ID,
    });
  });

  it('沒給 scopes：存 null（跟著帳號）', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    expect(ctx.repo.insert.mock.calls[0]?.[0].scopes).toBeNull();
  });

  it('scopes 裡不在目錄的鍵被濾掉', async () => {
    const ctx = setup();
    const scopes = ['role:read', 'legacy:gone'] as PermissionKey[];
    await inTenant(() => ctx.service.create(account(), dto({ scopes }), ALICE));
    expect(ctx.repo.insert.mock.calls[0]?.[0].scopes).toEqual(['role:read']);
  });

  it('每次建立的 secret 都不同', async () => {
    const ctx = setup();
    const first = await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    const second = await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    expect(parseToken(first.token)?.secret).not.toBe(parseToken(second.token)?.secret);
  });

  it('回應的 apiToken 是重新讀出的列（帶建立者名稱），狀態 active', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    const id = ctx.repo.insert.mock.calls[0]?.[0].id ?? '';
    expect(ctx.repo.findOne).toHaveBeenCalledWith(ALICE_ID, id);
    expect(result.apiToken).toMatchObject({
      id,
      status: 'active',
      createdBy: { id: ADMIN_ID, displayName: 'Admin' },
    });
  });

  it('剛建立的列讀不到是程式錯誤：拋一般的 Error，不是 AppException', async () => {
    const ctx = setup();
    ctx.repo.findOne.mockResolvedValue(undefined);
    const error = await inTenant(() => ctx.service.create(account(), dto(), ALICE)).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppException);
  });

  it('剛建立的列讀不到：不推播（呼叫端沒拿到 secret，其他分頁也不該看到這把 token）', async () => {
    const ctx = setup();
    ctx.repo.findOne.mockResolvedValue(undefined);
    await inTenant(() => ctx.service.create(account(), dto(), ALICE)).catch(() => undefined);
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('不在租戶脈絡裡呼叫是程式錯誤（token 需要租戶代碼）', async () => {
    const ctx = setup();
    await expect(ctx.service.create(account(), dto(), ALICE)).rejects.toThrow();
    expect(ctx.repo.insert).not.toHaveBeenCalled();
  });
});

describe('ApiTokenService.create 的稽核與推播（CLAUDE.md 後端規則 6）', () => {
  it('稽核在交易內：同一個 tx，記下名稱、scopes、到期時間與擁有者', async () => {
    const ctx = setup();
    const scopes: PermissionKey[] = ['role:read'];
    await inTenant(() => ctx.service.create(SERVICE_ACCOUNT, dto({ scopes }), ADMIN));
    const values = ctx.repo.insert.mock.calls[0]?.[0];
    expect(ctx.audit.record).toHaveBeenCalledWith(
      {
        action: 'apiToken.create',
        resourceType: RESOURCE_TYPE.API_TOKEN,
        resourceId: values?.id,
        resourceName: 'CI',
        changes: {
          after: {
            name: 'CI',
            scopes,
            expiresAt: values?.expiresAt.toISOString(),
          },
        },
        metadata: { ownerId: SERVICE_ID, ownerKind: 'service', prefix: values?.prefix },
      },
      ctx.tx,
    );
  });

  it('稽核內容不含 token 原文或 secret', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    const secret = parseToken(result.token)?.secret ?? '';
    expect(JSON.stringify(ctx.audit.record.mock.calls)).not.toContain(secret);
  });

  it('順序：交易內寫入與稽核 → 提交 → 推播', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    expect(ctx.order).toEqual([
      'tx:begin',
      'repo:insert',
      'audit:record',
      'tx:commit',
      'events:publish',
    ]);
  });

  it('稽核失敗：交易回滾，不推播', async () => {
    const ctx = setup();
    ctx.audit.record.mockRejectedValue(new Error('audit down'));
    await expect(inTenant(() => ctx.service.create(account(), dto(), ALICE))).rejects.toThrow(
      'audit down',
    );
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('個人 token 的推播給本人（affectedUserIds），kind 是 create', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    const id = ctx.repo.insert.mock.calls[0]?.[0].id;
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.API_TOKEN, kind: ChangeKind.CREATE, id }],
      affectedUserIds: [ALICE_ID],
    });
  });

  it('服務帳號的 token 推播以 refs 帶上擁有者，不指定收件人', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(SERVICE_ACCOUNT, dto(), ADMIN));
    const id = ctx.repo.insert.mock.calls[0]?.[0].id;
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        {
          resource: ChangeSource.API_TOKEN,
          kind: ChangeKind.CREATE,
          id,
          refs: { [ChangeSource.SERVICE_ACCOUNT]: [SERVICE_ID] },
        },
      ],
    });
  });
});

describe('ApiTokenService.create 的反提權（docs/architecture/06-external-api.md §9.2 D4）', () => {
  it('替自己建立：不檢查反提權（token 拿不到比帳號更多的權限）', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.create(account(), dto(), ALICE));
    expect(ctx.permissions.getPermissionSet).not.toHaveBeenCalled();
    expect(ctx.permissions.assertCanGrant).not.toHaveBeenCalled();
  });

  it('替別人建立、不限縮：帳號持有的每個權限鍵都要是操作者能授予的', async () => {
    const ctx = setup();
    ctx.permissions.getPermissionSet.mockResolvedValue(permissionSet(['role:read', 'user:read']));
    await inTenant(() => ctx.service.create(SERVICE_ACCOUNT, dto(), ADMIN));
    expect(ctx.permissions.getPermissionSet).toHaveBeenCalledWith(SERVICE_ID);
    expect(ctx.permissions.assertCanGrant.mock.calls[0]?.[0]).toBe(ADMIN_ID);
    expect(grantedRelations(ctx)).toEqual(['role:read', 'user:read']);
  });

  it('帳號是 super-admin、不限縮：操作者也要能授予 super-admin', async () => {
    const ctx = setup();
    ctx.permissions.getPermissionSet.mockResolvedValue(permissionSet(['role:read'], true));
    await inTenant(() => ctx.service.create(SERVICE_ACCOUNT, dto(), ADMIN));
    expect(grantedRelations(ctx)).toEqual([SUPER_ADMIN_RELATION, 'role:read'].toSorted());
  });

  it('限縮 scopes：比對的是 scopes 的閉包與帳號權限的交集', async () => {
    const ctx = setup();
    // user:update 的閉包是 user:update、user:resetPassword、user:read；帳號沒有 user:resetPassword
    ctx.permissions.getPermissionSet.mockResolvedValue(
      permissionSet(['user:update', 'user:read', 'system:read']),
    );
    await inTenant(() =>
      ctx.service.create(SERVICE_ACCOUNT, dto({ scopes: ['user:update'] }), ADMIN),
    );
    expect(grantedRelations(ctx)).toEqual(['user:read', 'user:update']);
  });

  it('限縮 scopes 且帳號是 super-admin：比對 scopes 的完整閉包，不要求 super-admin', async () => {
    const ctx = setup();
    ctx.permissions.getPermissionSet.mockResolvedValue(permissionSet([], true));
    await inTenant(() =>
      ctx.service.create(SERVICE_ACCOUNT, dto({ scopes: ['user:update'] }), ADMIN),
    );
    expect(grantedRelations(ctx)).toEqual(['user:read', 'user:resetPassword', 'user:update']);
  });

  it('限縮到帳號沒有的權限：那些鍵不必操作者持有（token 本來就拿不到）', async () => {
    const ctx = setup();
    ctx.permissions.getPermissionSet.mockResolvedValue(permissionSet(['role:read']));
    await inTenant(() =>
      ctx.service.create(SERVICE_ACCOUNT, dto({ scopes: ['system:update'] }), ADMIN),
    );
    expect(grantedRelations(ctx)).toEqual([]);
  });

  it('操作者不能授予 → 拋出 assertCanGrant 的錯誤，不開交易、不寫入', async () => {
    const ctx = setup();
    ctx.permissions.getPermissionSet.mockResolvedValue(permissionSet(['role:read']));
    ctx.permissions.assertCanGrant.mockRejectedValue(new AppException('AUTHZ_FORBIDDEN'));
    await expectCode(
      inTenant(() => ctx.service.create(SERVICE_ACCOUNT, dto(), ADMIN)),
      'AUTHZ_FORBIDDEN',
    );
    expect(ctx.db.transaction).not.toHaveBeenCalled();
    expect(ctx.repo.insert).not.toHaveBeenCalled();
  });

  it('反提權在到期上限之後檢查：超過上限時不查權限', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.create(SERVICE_ACCOUNT, dto({ expiresInDays: 366 }), ADMIN)),
      'API_TOKEN_LIFETIME_EXCEEDED',
    );
    expect(ctx.permissions.getPermissionSet).not.toHaveBeenCalled();
  });
});

describe('ApiTokenService.revoke（docs/architecture/06-external-api.md §9.2 D17）', () => {
  it('不存在、已撤銷或不屬於這個帳號 → API_TOKEN_NOT_FOUND，不記稽核、不失效快取、不推播', async () => {
    const ctx = setup();
    ctx.repo.revoke.mockResolvedValue(undefined);
    await expectCode(
      inTenant(() => ctx.service.revoke(account(), TOKEN_ID, ALICE)),
      'API_TOKEN_NOT_FOUND',
    );
    expect(ctx.audit.record).not.toHaveBeenCalled();
    expect(ctx.cache.invalidate).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('稽核在交易內：同一個 tx，記下擁有者與 prefix', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.revoke(SERVICE_ACCOUNT, TOKEN_ID, ADMIN));
    expect(ctx.audit.record).toHaveBeenCalledWith(
      {
        action: 'apiToken.revoke',
        resourceType: RESOURCE_TYPE.API_TOKEN,
        resourceId: TOKEN_ID,
        resourceName: 'CI',
        metadata: { ownerId: SERVICE_ID, ownerKind: 'service', prefix: 'b2bt_acme_abc_wxyz' },
      },
      ctx.tx,
    );
  });

  it('順序：交易內撤銷與稽核 → 提交 → 驗證快取失效 → 推播', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.revoke(account(), TOKEN_ID, ALICE));
    expect(ctx.order).toEqual([
      'tx:begin',
      'repo:revoke',
      'audit:record',
      'tx:commit',
      'cache:invalidate',
      'events:publish',
    ]);
  });

  it('失效的是這把 token 的驗證快取', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.revoke(account(), TOKEN_ID, ALICE));
    expect(ctx.cache.invalidate).toHaveBeenCalledWith([TOKEN_ID]);
  });

  it('撤銷的推播是 update（token 仍在列表上，只是狀態變了）', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.revoke(account(), TOKEN_ID, ALICE));
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.API_TOKEN, kind: ChangeKind.UPDATE, id: TOKEN_ID }],
      affectedUserIds: [ALICE_ID],
    });
  });

  it('稽核失敗：交易回滾，不失效快取、不推播', async () => {
    const ctx = setup();
    ctx.audit.record.mockRejectedValue(new Error('audit down'));
    await expect(inTenant(() => ctx.service.revoke(account(), TOKEN_ID, ALICE))).rejects.toThrow(
      'audit down',
    );
    expect(ctx.cache.invalidate).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });
});

describe('ApiTokenService.revokeAllInTransaction（帳號刪除時，docs/architecture/06-external-api.md §9.2 D5）', () => {
  it('在呼叫端的交易內撤銷全部，回傳撤銷的數量；不失效快取、不推播', async () => {
    const ctx = setup();
    const outerTx = { outer: true };
    await expect(
      ctx.service.revokeAllInTransaction(SERVICE_ID, ADMIN_ID, outerTx as never),
    ).resolves.toBe(4);
    expect(ctx.repo.revokeAll).toHaveBeenCalledWith(SERVICE_ID, ADMIN_ID, outerTx);
    expect(ctx.db.transaction).not.toHaveBeenCalled();
    expect(ctx.cache.invalidate).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });
});

/** 在對外 API 的請求脈絡裡（`ApiTokenAuthGuard` 已寫入 token）執行。 */
function withToken<T>(tokenId: string | undefined, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    {
      requestId: 'req-1',
      ...(tokenId ? { apiToken: { id: tokenId, userId: ALICE_ID } } : {}),
    },
    fn,
  );
}

describe('ApiTokenService.describeCurrent（GET /v1/me，docs/architecture/06-external-api.md §9.2 D14）', () => {
  it('回傳帳號、token 與實際取得的權限', async () => {
    const ctx = setup();
    ctx.repo.findOne.mockResolvedValue(tokenRow({ scopes: ['role:read'] }));
    const result = await withToken(TOKEN_ID, () => ctx.service.describeCurrent(ALICE));
    expect(ctx.repo.findOne).toHaveBeenCalledWith(ALICE_ID, TOKEN_ID);
    expect(ctx.permissions.getEffectivePermissionKeys).toHaveBeenCalledWith(ALICE_ID);
    expect(result).toEqual({
      account: { id: ALICE_ID, kind: 'human', name: 'Alice', email: 'alice@example.com' },
      token: {
        id: TOKEN_ID,
        name: 'CI',
        prefix: 'b2bt_acme_abc_wxyz',
        scopes: ['role:read'],
        expiresAt: new Date(NOW.getTime() + 30 * DAY_MS).toISOString(),
      },
      permissions: ['role:read'],
    });
  });

  it('服務帳號：email 是 null（不回傳不可投遞的佔位值）', async () => {
    const ctx = setup();
    const service = { id: SERVICE_ID, email: 'svc@service.invalid' } as AuthUser;
    const result = await withToken(TOKEN_ID, () => ctx.service.describeCurrent(service));
    expect(result.account).toEqual({
      id: SERVICE_ID,
      kind: 'service',
      name: 'CI bot',
      email: null,
    });
  });

  it('token 的 scopes 裡不在目錄的鍵被濾掉', async () => {
    const ctx = setup();
    ctx.repo.findOne.mockResolvedValue(tokenRow({ scopes: ['role:read', 'legacy:gone'] }));
    const result = await withToken(TOKEN_ID, () => ctx.service.describeCurrent(ALICE));
    expect(result.token.scopes).toEqual(['role:read']);
  });

  it('請求脈絡裡沒有 token → AUTH_TOKEN_INVALID', async () => {
    const ctx = setup();
    await expectCode(
      withToken(undefined, () => ctx.service.describeCurrent(ALICE)),
      'AUTH_TOKEN_INVALID',
    );
    expect(ctx.repo.findOne).not.toHaveBeenCalled();
  });

  it('帳號已不存在 → AUTH_TOKEN_INVALID', async () => {
    const ctx = setup();
    ctx.accounts.delete(ALICE_ID);
    await expectCode(
      withToken(TOKEN_ID, () => ctx.service.describeCurrent(ALICE)),
      'AUTH_TOKEN_INVALID',
    );
  });

  it('token 不屬於這個帳號（或已不存在）→ AUTH_TOKEN_INVALID', async () => {
    const ctx = setup();
    ctx.repo.findOne.mockResolvedValue(undefined);
    await expectCode(
      withToken(TOKEN_ID, () => ctx.service.describeCurrent(ALICE)),
      'AUTH_TOKEN_INVALID',
    );
    expect(ctx.permissions.getEffectivePermissionKeys).not.toHaveBeenCalled();
  });
});
