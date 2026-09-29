import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { IdentityProviderInsert, IdentityProviderRow, UserIdentityRow } from '@/db/schema';
import { identityProviderDomains, identityProviders, userIdentities } from '@/db/schema';

export interface ProviderDomain {
  domain: string;
  ssoOnly: boolean;
}

export interface ProviderWithDomains extends IdentityProviderRow {
  domains: ProviderDomain[];
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
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // ── 連線 ─────────────────────────────────────────────────

  async list(): Promise<ProviderWithDomains[]> {
    const rows = await this.db
      .select({ provider: identityProviders, domains: DOMAIN_AGGREGATE })
      .from(identityProviders)
      .where(isNull(identityProviders.deletedAt))
      .orderBy(asc(identityProviders.name));
    return rows.map((row) => ({ ...row.provider, domains: row.domains }));
  }

  async findById(id: string, tx?: DbOrTx): Promise<ProviderWithDomains | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select({ provider: identityProviders, domains: DOMAIN_AGGREGATE })
      .from(identityProviders)
      .where(and(eq(identityProviders.id, id), isNull(identityProviders.deletedAt)))
      .limit(1);
    return row && { ...row.provider, domains: row.domains };
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
      .where(and(eq(identityProviders.id, id), isNull(identityProviders.deletedAt)))
      .returning();
    return row;
  }

  /** 軟刪除並釋出網域（網域之後可以給別的連線）。已連結的外部身分留著，但不再能登入。 */
  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .update(identityProviders)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(identityProviders.id, id), isNull(identityProviders.deletedAt)))
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
          isNull(identityProviders.deletedAt),
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

  async touchIdentity(id: string): Promise<void> {
    await this.db
      .update(userIdentities)
      .set({ lastLoginAt: new Date() })
      .where(eq(userIdentities.id, id));
  }
}
