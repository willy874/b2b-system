import { randomUUID } from 'node:crypto';

import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { formatToken, generateSecret, tokenPrefix } from '@/common/auth';
import type { AuthUser, PermissionKey } from '@/common/types';
import { SUPER_ADMIN_RELATION, TENANT_OBJECT } from '@/core/authz';
import type { RelationRef } from '@/core/authz';
import { ApiTokenCacheService } from '@/core/cache';
import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { getRequestContext } from '@/core/http';
import { RESOURCE_TYPE } from '@/core/resource';
import { SettingService } from '@/core/settings';
import { requireTenant } from '@/core/tenant';
import { isPermissionKey, permissionClosure } from '@/db/seeds/permissions';
import { AuditService } from '@/modules/audit-log/audit.service';
import { sha256 } from '@/modules/credential/token-hash';
import { PermissionService } from '@/modules/permission/permission.service';

import { API_TOKEN_MAX_ACTIVE_PER_ACCOUNT } from './api-token.constants';
import type { ApiTokenWithCreator, TokenAccount } from './api-token.repository';
import { ApiTokenRepository } from './api-token.repository';
import {
  PERSONAL_TOKEN_MAX_DAYS_SETTING,
  SERVICE_ACCOUNT_TOKEN_MAX_DAYS_SETTING,
} from './api-token.settings';
import type {
  ApiTokenDto,
  ApiTokenStatus,
  CreateApiTokenDto,
  CreatedApiTokenDto,
  ExternalMeDto,
} from './dto/api-token.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

function statusOf(token: ApiTokenWithCreator, account: TokenAccount, now: Date): ApiTokenStatus {
  if (token.revokedAt) return 'revoked';
  if (token.accountVersion !== account.tokenVersion) return 'invalidated';
  if (token.expiresAt <= now) return 'expired';
  return 'active';
}

function toDto(token: ApiTokenWithCreator, account: TokenAccount, now: Date): ApiTokenDto {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    // 目錄之後移除的鍵讀取時濾掉（驗證時本來就不會用到）
    scopes: token.scopes?.filter(isPermissionKey) ?? null,
    status: statusOf(token, account, now),
    expiresAt: token.expiresAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
    createdBy: token.creator,
  };
}

/**
 * API token 的建立、列出與撤銷（docs/architecture/06-external-api.md §9.2 D2～D8）。
 * 擁有者可以是本人（個人 token）或服務帳號；呼叫端負責確認操作者有權管理那個擁有者
 * （本人、`user:update`、`serviceAccount:update`），這裡負責 token 本身的規則。
 * 驗證 token 在對外 API（T2），不在這裡。
 */
@Injectable()
export class ApiTokenService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: ApiTokenRepository,
    private readonly permissions: PermissionService,
    private readonly settings: SettingService,
    private readonly audit: AuditService,
    private readonly cache: ApiTokenCacheService,
    private readonly events: DomainEventBus,
  ) {}

  // ── 個人 token（`/auth/api-tokens`，本人）與管理者看別人的（`/users/:userId/api-tokens`，`user:update`） ──

  async listMine(actor: AuthUser): Promise<{ items: ApiTokenDto[] }> {
    return {
      items: await this.list(await this.requireAccount(actor.id, 'human', 'USER_NOT_FOUND')),
    };
  }

  async createMine(actor: AuthUser, dto: CreateApiTokenDto): Promise<CreatedApiTokenDto> {
    return this.create(await this.requireAccount(actor.id, 'human', 'USER_NOT_FOUND'), dto, actor);
  }

  async revokeMine(actor: AuthUser, tokenId: string): Promise<void> {
    await this.revoke(
      await this.requireAccount(actor.id, 'human', 'USER_NOT_FOUND'),
      tokenId,
      actor,
    );
  }

  async listForUser(userId: string): Promise<{ items: ApiTokenDto[] }> {
    return { items: await this.list(await this.requireAccount(userId, 'human', 'USER_NOT_FOUND')) };
  }

  async revokeForUser(userId: string, tokenId: string, actor: AuthUser): Promise<void> {
    await this.revoke(await this.requireAccount(userId, 'human', 'USER_NOT_FOUND'), tokenId, actor);
  }

  // ── 對外 API ──

  /** `GET /v1/me`：以目前請求的 token 認證的帳號與 token（`ApiTokenAuthGuard` 已寫進請求脈絡）。 */
  async describeCurrent(actor: AuthUser): Promise<ExternalMeDto> {
    const tokenId = getRequestContext()?.apiToken?.id;
    const account = await this.repo.findAccount(actor.id);
    const token = tokenId ? await this.repo.findOne(actor.id, tokenId) : undefined;
    if (!account || !token) throw new AppException('AUTH_TOKEN_INVALID');
    return {
      account: {
        id: account.id,
        kind: account.kind,
        name: account.displayName,
        email: account.kind === 'human' ? account.email : null,
      },
      token: {
        id: token.id,
        name: token.name,
        prefix: token.prefix,
        scopes: token.scopes?.filter(isPermissionKey) ?? null,
        expiresAt: token.expiresAt.toISOString(),
      },
      // 與 scopes 的交集由 PermissionService 依請求脈絡計算
      permissions: await this.permissions.getEffectivePermissionKeys(actor.id),
    };
  }

  // ── 通用：服務帳號的 token 由 modules/service-account 先確認帳號後呼叫 ──

  /** 擁有者存在（未刪除）且種類相符；否則以呼叫端給的錯誤碼回應（`USER_NOT_FOUND`／`SERVICE_ACCOUNT_NOT_FOUND`）。 */
  async requireAccount(
    userId: string,
    kind: TokenAccount['kind'],
    notFound: 'USER_NOT_FOUND' | 'SERVICE_ACCOUNT_NOT_FOUND',
  ): Promise<TokenAccount> {
    const account = await this.repo.findAccount(userId);
    if (!account || account.kind !== kind) throw new AppException(notFound);
    return account;
  }

  async list(account: TokenAccount): Promise<ApiTokenDto[]> {
    const now = new Date();
    return (await this.repo.list(account.id)).map((token) => toDto(token, account, now));
  }

  /**
   * 建立 token：到期上限（D8）、有效 token 數上限、反提權（D4）通過後寫入並記稽核。
   * 回傳的 `token` 只出現這一次。
   */
  async create(
    account: TokenAccount,
    dto: CreateApiTokenDto,
    actor: AuthUser,
  ): Promise<CreatedApiTokenDto> {
    const maxDays = await this.settings.get(
      account.kind === 'service'
        ? SERVICE_ACCOUNT_TOKEN_MAX_DAYS_SETTING
        : PERSONAL_TOKEN_MAX_DAYS_SETTING,
    );
    if (dto.expiresInDays > maxDays) {
      throw new AppException('API_TOKEN_LIFETIME_EXCEEDED', { maxDays });
    }
    const scopes = dto.scopes ? dto.scopes.filter(isPermissionKey) : null;
    if (account.id !== actor.id) await this.assertNotEscalating(actor.id, account.id, scopes);

    const now = new Date();
    const secret = generateSecret();
    const { code } = requireTenant();
    const { row, token } = await withTransaction(this.db, async (tx) => {
      if ((await this.repo.countActive(account.id, now, tx)) >= API_TOKEN_MAX_ACTIVE_PER_ACCOUNT) {
        throw new AppException('API_TOKEN_LIMIT_REACHED', {
          max: API_TOKEN_MAX_ACTIVE_PER_ACCOUNT,
        });
      }
      const id = randomUUID();
      const raw = formatToken(code, id, secret);
      const inserted = await this.repo.insert(
        {
          id,
          userId: account.id,
          name: dto.name,
          prefix: tokenPrefix(raw),
          secretHash: sha256(secret),
          scopes,
          accountVersion: account.tokenVersion,
          expiresAt: new Date(now.getTime() + dto.expiresInDays * DAY_MS),
          createdBy: actor.id,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'apiToken.create',
          resourceType: RESOURCE_TYPE.API_TOKEN,
          resourceId: inserted.id,
          resourceName: inserted.name,
          changes: {
            after: {
              name: inserted.name,
              scopes,
              expiresAt: inserted.expiresAt.toISOString(),
            },
          },
          metadata: { ownerId: account.id, ownerKind: account.kind, prefix: inserted.prefix },
        },
        tx,
      );
      return { row: inserted, token: raw };
    });

    // 列表的同一個查詢：補上建立者的顯示名稱
    this.publish(ChangeKind.CREATE, account, row.id);
    const created = await this.repo.findOne(account.id, row.id);
    if (!created) throw new Error('剛建立的 API token 讀不到');
    return { token, apiToken: toDto(created, account, now) };
  }

  /** 撤銷；已撤銷或不屬於這個帳號的 token 回 `API_TOKEN_NOT_FOUND`。 */
  async revoke(account: TokenAccount, tokenId: string, actor: AuthUser): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const row = await this.repo.revoke(account.id, tokenId, actor.id, tx);
      if (!row) throw new AppException('API_TOKEN_NOT_FOUND');
      await this.audit.record(
        {
          action: 'apiToken.revoke',
          resourceType: RESOURCE_TYPE.API_TOKEN,
          resourceId: row.id,
          resourceName: row.name,
          metadata: { ownerId: account.id, ownerKind: account.kind, prefix: row.prefix },
        },
        tx,
      );
    });
    // 對外 API 的驗證快取（D17）：本機與其他程序立即失效
    this.cache.invalidate([tokenId]);
    this.publish(ChangeKind.UPDATE, account, tokenId);
  }

  /**
   * token 列表的推播：個人 token 推給本人（其他分頁的帳號設定），服務帳號的 token 以 refs 帶上擁有者
   * （列表上的有效 token 數）。撤銷是 `update`：token 還在列表上，只是狀態變了。
   */
  private publish(kind: ChangeKind, account: TokenAccount, tokenId: string): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        {
          resource: ChangeSource.API_TOKEN,
          kind,
          id: tokenId,
          ...(account.kind === 'service'
            ? { refs: { [ChangeSource.SERVICE_ACCOUNT]: [account.id] } }
            : {}),
        },
      ],
      ...(account.kind === 'human' ? { affectedUserIds: [account.id] } : {}),
    });
  }

  /**
   * 帳號被刪除時，在同一個交易內把它還沒撤銷的 token 標成撤銷；回傳撤銷的數量。
   * 不必失效驗證快取：刪除遞增了 `token_version`，對外 API 驗證帳號時就擋下（使用者快取會廣播）。
   */
  revokeAllInTransaction(userId: string, actorId: string, tx: DbOrTx): Promise<number> {
    return this.repo.revokeAll(userId, actorId, tx);
  }

  /**
   * 反提權（D4）：token 取得的有效權限（帳號的權限 ∩ scopes 的閉包）必須是操作者持有的。
   * 帳號是 super-admin 而沒有限縮 scope 時，token 取得的是 super-admin，操作者也要是 super-admin。
   *
   * 只比對租戶層的權限鍵：資料夾等資源上的能力跟著帳號走（D3），不在 scope 裡，這裡也不比對
   * （見 docs/architecture/06-external-api.md §9 的實作紀錄）。
   */
  private async assertNotEscalating(
    actorId: string,
    accountId: string,
    scopes: readonly PermissionKey[] | null,
  ): Promise<void> {
    const owner = await this.permissions.getPermissionSet(accountId);
    let keys: PermissionKey[];
    let superAdmin = false;
    if (scopes) {
      const requested = permissionClosure(scopes);
      keys = owner.isSuperAdmin
        ? [...requested]
        : [...requested].filter((key) => owner.permissions.has(key));
    } else {
      keys = [...owner.permissions];
      superAdmin = owner.isSuperAdmin;
    }
    const targets: RelationRef[] = keys.map((key) => ({ object: TENANT_OBJECT, relation: key }));
    if (superAdmin) targets.push({ object: TENANT_OBJECT, relation: SUPER_ADMIN_RELATION });
    await this.permissions.assertCanGrant(actorId, targets);
  }
}
