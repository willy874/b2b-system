import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, countDistinct, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import type {
  IdentityProviderInsert,
  IdentityProviderProtocol,
  IdentityProviderRow,
  UserIdentityRow,
} from '@/db/schema';
import {
  identityProviderDomains,
  identityProviders,
  notDeleted,
  userIdentities,
  users,
} from '@/db/schema';

export interface ProviderDomain {
  domain: string;
  ssoOnly: boolean;
}

export interface ProviderWithDomains extends IdentityProviderRow {
  domains: ProviderDomain[];
}

/** 管理員檢視的外部身分：連線已刪除的也列出（名稱照舊）。 */
export interface UserIdentityWithProvider extends UserIdentityRow {
  providerName: string;
  protocol: IdentityProviderProtocol;
  providerDeleted: boolean;
}

// 單表 select 時 Drizzle 把 ${identityProviders.id} 輸出成不帶表名的 "id"；明確寫出表名才會關聯到外層
const OUTER_PROVIDER_ID = sql`${identityProviders}.${sql.identifier(identityProviders.id.name)}`;

const DOMAIN_AGGREGATE = sql<ProviderDomain[]>`COALESCE(
  (
    SELECT json_agg(json_build_object('domain', d.domain, 'ssoOnly', d.sso_only) ORDER BY d.domain)
    FROM ${identityProviderDomains} d
    WHERE d.provider_id = ${OUTER_PROVIDER_ID}
  ),
  '[]'
)`;

@Injectable()
export class IdentityProviderRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  // ── 連線 ─────────────────────────────────────────────────

  async list(): Promise<ProviderWithDomains[]> {
    const rows = await this.db
      .select({ provider: identityProviders, domains: DOMAIN_AGGREGATE })
      .from(identityProviders)
      .where(notDeleted(identityProviders))
      .orderBy(asc(identityProviders.name));
    return rows.map((row) => ({ ...row.provider, domains: row.domains }));
  }

  async findById(id: string, tx?: DbOrTx): Promise<ProviderWithDomains | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select({ provider: identityProviders, domains: DOMAIN_AGGREGATE })
      .from(identityProviders)
      .where(and(eq(identityProviders.id, id), notDeleted(identityProviders)))
      .limit(1);
    return row && { ...row.provider, domains: row.domains };
  }

  /**
   * 關閉 feature `identityProvider` 會影響的數量（平台管理者的確認框）：連線、只允許 SSO 的網域，
   * 以及連結了外部身分、自己沒有密碼的使用者——他們之後要先重設密碼才能登入。
   */
  async countImpact(): Promise<{
    connections: number;
    ssoOnlyDomains: number;
    passwordlessUsers: number;
  }> {
    const [connections] = await this.db
      .select({ total: count() })
      .from(identityProviders)
      .where(notDeleted(identityProviders));
    const [domains] = await this.db
      .select({ total: count() })
      .from(identityProviderDomains)
      .innerJoin(identityProviders, eq(identityProviders.id, identityProviderDomains.providerId))
      .where(and(eq(identityProviderDomains.ssoOnly, true), notDeleted(identityProviders)));
    const [passwordless] = await this.db
      .select({ total: countDistinct(userIdentities.userId) })
      .from(userIdentities)
      .innerJoin(identityProviders, eq(identityProviders.id, userIdentities.providerId))
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(and(notDeleted(identityProviders), notDeleted(users), isNull(users.passwordHash)));
    return {
      connections: connections?.total ?? 0,
      ssoOnlyDomains: domains?.total ?? 0,
      passwordlessUsers: passwordless?.total ?? 0,
    };
  }

  /**
   * 建立前序列化並數現有的連線（docs/architecture/05-tenancy.md §13.3 D10）：
   * 同時建立兩個不會一起超過上限。
   */
  async lockAndCount(tx: DbOrTx): Promise<number> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('identity_providers:count'))`);
    const [row] = await tx
      .select({ total: count() })
      .from(identityProviders)
      .where(notDeleted(identityProviders));
    return row?.total ?? 0;
  }

  async create(values: IdentityProviderInsert, tx: DbOrTx): Promise<IdentityProviderRow> {
    const [row] = await tx.insert(identityProviders).values(values).returning();
    if (!row) throw new Error('建立外部 IdP 連線失敗');
    return row;
  }

  async update(
    id: string,
    values: Partial<IdentityProviderInsert>,
    tx: DbOrTx,
  ): Promise<IdentityProviderRow | undefined> {
    const [row] = await tx
      .update(identityProviders)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(identityProviders.id, id), notDeleted(identityProviders)))
      .returning();
    return row;
  }

  /** 軟刪除並釋出網域（網域之後可以給別的連線）。已連結的外部身分留著，但不再能登入。 */
  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .update(identityProviders)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(identityProviders.id, id), notDeleted(identityProviders)))
      .returning({ id: identityProviders.id });
    await tx.delete(identityProviderDomains).where(eq(identityProviderDomains.providerId, id));
    return rows.length > 0;
  }

  /** 整批取代網域；網域已屬於別的連線時主鍵衝突（由 service 轉成業務錯誤）。 */
  async replaceDomains(
    providerId: string,
    domains: readonly ProviderDomain[],
    tx: DbOrTx,
  ): Promise<void> {
    await tx
      .delete(identityProviderDomains)
      .where(eq(identityProviderDomains.providerId, providerId));
    if (domains.length === 0) return;
    await tx
      .insert(identityProviderDomains)
      .values(domains.map((item) => ({ providerId, domain: item.domain, ssoOnly: item.ssoOnly })));
  }

  // ── 登入時查詢 ───────────────────────────────────────────

  /** email 網域對應的連線（未刪除；停用的也回傳，由呼叫端判斷）。 */
  async findByDomain(
    domain: string,
  ): Promise<{ provider: IdentityProviderRow; ssoOnly: boolean } | undefined> {
    const [row] = await this.db
      .select({ provider: identityProviders, ssoOnly: identityProviderDomains.ssoOnly })
      .from(identityProviderDomains)
      .innerJoin(
        identityProviders,
        and(
          eq(identityProviders.id, identityProviderDomains.providerId),
          notDeleted(identityProviders),
        ),
      )
      .where(eq(identityProviderDomains.domain, domain))
      .limit(1);
    return row;
  }

  // ── 外部身分 ─────────────────────────────────────────────

  async findIdentity(providerId: string, subject: string): Promise<UserIdentityRow | undefined> {
    const [row] = await this.db
      .select()
      .from(userIdentities)
      .where(and(eq(userIdentities.providerId, providerId), eq(userIdentities.subject, subject)))
      .limit(1);
    return row;
  }

  async linkIdentity(
    values: { userId: string; providerId: string; subject: string; email: string | null },
    tx?: DbOrTx,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db.insert(userIdentities).values({ ...values, lastLoginAt: new Date() });
  }

  /** 刪除一個人的所有外部身分連結；回傳刪除筆數。 */
  async deleteIdentitiesOfUser(userId: string, tx?: DbOrTx): Promise<number> {
    const rows = await (tx ?? this.db)
      .delete(userIdentities)
      .where(eq(userIdentities.userId, userId))
      .returning({ id: userIdentities.id });
    return rows.length;
  }

  /** 刪除一個連線的所有外部身分連結（issuer 或 client 換了：舊的 subject 不再代表同一個人）；回傳刪除筆數。 */
  async deleteIdentitiesOfProvider(providerId: string, tx?: DbOrTx): Promise<number> {
    const rows = await (tx ?? this.db)
      .delete(userIdentities)
      .where(eq(userIdentities.providerId, providerId))
      .returning({ id: userIdentities.id });
    return rows.length;
  }

  /** 刪除單一連結（指向已刪除的帳號）。 */
  async deleteIdentity(id: string): Promise<void> {
    await this.db.delete(userIdentities).where(eq(userIdentities.id, id));
  }

  /** 帳號存在且未刪除（列出外部身分之前確認）。 */
  async userExists(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), notDeleted(users)))
      .limit(1);
    return Boolean(row);
  }

  async listIdentitiesOfUser(userId: string): Promise<UserIdentityWithProvider[]> {
    const rows = await this.db
      .select({
        identity: userIdentities,
        providerName: identityProviders.name,
        protocol: identityProviders.protocol,
        providerDeletedAt: identityProviders.deletedAt,
      })
      .from(userIdentities)
      .innerJoin(identityProviders, eq(identityProviders.id, userIdentities.providerId))
      .where(eq(userIdentities.userId, userId))
      .orderBy(desc(userIdentities.linkedAt));
    return rows.map((row) => ({
      ...row.identity,
      providerName: row.providerName,
      protocol: row.protocol,
      providerDeleted: row.providerDeletedAt !== null,
    }));
  }

  /** 屬於這個（未刪除的）帳號的一筆外部身分，連同帳號的 email（稽核的資源名稱）。 */
  async findIdentityOfUser(
    userId: string,
    identityId: string,
  ): Promise<(UserIdentityRow & { userEmail: string }) | undefined> {
    const [row] = await this.db
      .select({ identity: userIdentities, userEmail: users.email })
      .from(userIdentities)
      .innerJoin(users, and(eq(users.id, userIdentities.userId), notDeleted(users)))
      .where(and(eq(userIdentities.id, identityId), eq(userIdentities.userId, userId)))
      .limit(1);
    return row && { ...row.identity, userEmail: row.userEmail };
  }

  /** 刪除屬於這個帳號的一筆外部身分；回傳是否刪到（併發的另一次解除已刪掉時是 false）。 */
  async deleteIdentityOfUser(userId: string, identityId: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .delete(userIdentities)
      .where(and(eq(userIdentities.id, identityId), eq(userIdentities.userId, userId)))
      .returning({ id: userIdentities.id });
    return rows.length > 0;
  }

  async touchIdentity(id: string): Promise<void> {
    await this.db
      .update(userIdentities)
      .set({ lastLoginAt: new Date() })
      .where(eq(userIdentities.id, id));
  }
}
