import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDatabase } from '@/core/database';
import { ensureTenantDatabase, migrateTenantDatabase } from '@/db/provision';

import { databaseUrlOf } from './global-setup';

/**
 * 連線的逾時（docs/architecture/backend/02-database.md §6.2）與非超級使用者的佈建角色
 * （docs/architecture/05-tenancy.md §7.1、deploy/postgres/10-roles.sh）。
 */

const PROVISIONER = { name: 'b2b_provisioner_test', password: 'provisioner-secret' };
const TENANT = { name: 'tenant_roles_check', password: 'abcdef0123456789abcdef' };
const NEIGHBOR = { name: 'tenant_roles_neighbor', password: '0123456789abcdef0123' };

function withCredentials(baseUrl: string, user: string, password: string, database: string) {
  const url = new URL(databaseUrlOf(baseUrl, database));
  url.username = user;
  url.password = password;
  return url.toString();
}

let platformUrl: string;
let superuser: postgres.Sql;

beforeAll(async () => {
  platformUrl = inject('platformDatabaseUrl');
  superuser = postgres(platformUrl, { max: 1, onnotice: () => {} });
  // 與 deploy/postgres/10-roles.sh 相同的佈建角色
  await superuser.unsafe(
    `CREATE ROLE ${PROVISIONER.name} LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD '${PROVISIONER.password}'`,
  );
  await superuser.unsafe(
    `ALTER ROLE ${PROVISIONER.name} SET createrole_self_grant TO 'set, inherit'`,
  );
});

afterAll(async () => {
  for (const tenant of [TENANT, NEIGHBOR]) {
    // oxlint-disable-next-line no-await-in-loop -- 清理兩個租戶
    await superuser.unsafe(`DROP DATABASE IF EXISTS ${tenant.name} WITH (FORCE)`);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await superuser.unsafe(`DROP ROLE IF EXISTS ${tenant.name}`);
  }
  await superuser.unsafe(`DROP ROLE IF EXISTS ${PROVISIONER.name}`);
  await superuser.end();
});

describe('每條連線的逾時', () => {
  it('超過 statement_timeout 的語句被取消（57014），連線池仍可繼續使用', async () => {
    const { client, db } = createDatabase({
      url: inject('databaseUrl'),
      max: 1,
      logQueries: false,
      limits: { connectTimeout: 10, statementTimeoutMs: 200, idleInTransactionTimeoutMs: 1000 },
    });
    try {
      await expect(db.execute(sql`SELECT pg_sleep(2)`)).rejects.toMatchObject({
        cause: { code: '57014' },
      });
      const [row] = await client`SHOW statement_timeout`;
      expect(row?.statement_timeout).toBe('200ms');
      const [idle] = await client`SHOW idle_in_transaction_session_timeout`;
      expect(idle?.idle_in_transaction_session_timeout).toBe('1s');
    } finally {
      await client.end();
    }
  });
});

describe('非超級使用者的佈建角色', () => {
  const adminUrl = () =>
    withCredentials(platformUrl, PROVISIONER.name, PROVISIONER.password, 'b2b_platform_test');
  const urlOf = (tenant: typeof TENANT, database = tenant.name) =>
    withCredentials(platformUrl, tenant.name, tenant.password, database);
  const tenantUrl = () => urlOf(TENANT);

  it('能建立租戶的角色與 database、重跑冪等、跑完租戶 migration', async () => {
    await ensureTenantDatabase(adminUrl(), tenantUrl());
    await ensureTenantDatabase(adminUrl(), tenantUrl());
    await migrateTenantDatabase(tenantUrl());

    const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
    const [role] = await admin`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
    await admin.end();
    expect(role?.rolsuper).toBe(false);

    const [owner] = await superuser`
      SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = ${TENANT.name}`;
    expect(owner?.owner).toBe(TENANT.name);
  });

  it('租戶的角色連不上別的租戶的 database', async () => {
    await ensureTenantDatabase(adminUrl(), urlOf(NEIGHBOR));
    const intruder = postgres(urlOf(TENANT, NEIGHBOR.name), { max: 1, onnotice: () => {} });
    await expect(intruder`SELECT 1`).rejects.toMatchObject({ code: '42501' });
    await intruder.end();
  });
});
