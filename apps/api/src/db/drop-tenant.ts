import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import postgres from 'postgres';

import { JOB_SCHEMA } from '@/core/jobs/job-store';
import { tenantAccountPrefix } from '@/modules/oidc-provider/oidc-account';

import { createPlatformScriptClient, loadScriptEnv, tenantSecretBox } from './client';
import { oidcPayloads, platformAuditLogs, tenants } from './platform/schema';

/**
 * 清除 **已刪除** 的租戶（docs/adr/0020-physical-tenant-isolation.md D13）：`DROP DATABASE`、`DROP ROLE`、
 * 清空並刪除 bucket，最後移除平台 DB 的登記。不可逆，所以不在管理頁：
 *
 *   pnpm db:drop-tenant <租戶代碼或 id>            # 只列出會清除什麼
 *   pnpm db:drop-tenant <租戶代碼或 id> --confirm  # 真的清除
 *
 * 只處理 apps/auth 刪除過的租戶；database 名稱不是佈建產生的（`tenant_` 開頭，例如 `db:migrate` 登記的預設租戶）時拒絕。
 */
const PROVISIONED_NAME = /^tenant_[a-z0-9_]+$/;

async function main(): Promise<void> {
  loadScriptEnv();
  const [target, flag] = process.argv.slice(2);
  if (!target) throw new Error('用法：pnpm db:drop-tenant <租戶代碼或 id> [--confirm]');
  const confirmed = flag === '--confirm';

  const platform = createPlatformScriptClient();
  try {
    const isId = /^[0-9a-f-]{36}$/.test(target);
    const rows = await platform.db
      .select()
      .from(tenants)
      .where(
        and(isNotNull(tenants.deletedAt), isId ? eq(tenants.id, target) : eq(tenants.code, target)),
      );
    if (!rows.length) throw new Error(`找不到已刪除的租戶 ${target}（先在 apps/auth 刪除）`);
    if (rows.length > 1) {
      throw new Error(
        `有 ${rows.length} 個已刪除的租戶叫 ${target}，請改用 id：\n` +
          rows.map((row) => `  ${row.id}（刪除於 ${row.deletedAt?.toISOString()}）`).join('\n'),
      );
    }
    const tenant = rows[0]!;
    const url = new URL(tenantSecretBox().decrypt(tenant.databaseUrlEncrypted));
    const database = decodeURIComponent(url.pathname.slice(1));
    const role = decodeURIComponent(url.username);
    if (!PROVISIONED_NAME.test(database) || !PROVISIONED_NAME.test(role)) {
      throw new Error(`租戶 ${tenant.code} 的 database（${database}）不是佈建產生的，拒絕清除`);
    }

    console.info(
      `租戶 ${tenant.code}（${tenant.id}）\n  database：${database}\n  DB 角色：${role}\n  bucket：${tenant.storageBucket}`,
    );
    if (!confirmed) {
      console.info('\n沒有加 --confirm：什麼都沒做。確認無誤後再加上 --confirm 執行。');
      return;
    }

    await dropBucket(tenant.storageBucket);
    const adminUrl =
      process.env.TENANT_PROVISIONING_DATABASE_URL || process.env.PLATFORM_DATABASE_URL;
    const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    try {
      // WITH (FORCE)：還有閒置的連線（api 的連線池）也一併中斷
      await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.end();
    }
    await platform.db.transaction(async (tx) => {
      // 殘留在平台 DB、指向這個租戶的東西：帳號在 IdP 的 session／grant、佇列裡的工作
      await tx
        .delete(oidcPayloads)
        .where(
          sql`${oidcPayloads.payload}->>'accountId' LIKE ${`${tenantAccountPrefix(tenant.id)}%`}`,
        );
      await tx.execute(
        sql`DELETE FROM ${sql.raw(JOB_SCHEMA)}.job WHERE data->>'tenantId' = ${tenant.id}`,
      );
      await tx.delete(tenants).where(eq(tenants.id, tenant.id));
      await tx.insert(platformAuditLogs).values({
        action: 'tenant.purge',
        actorEmail: 'system',
        resourceType: 'tenant',
        resourceId: tenant.id,
        result: 'success',
        metadata: { code: tenant.code, database, bucket: tenant.storageBucket },
      });
    });
    console.info(`已清除租戶 ${tenant.code}`);
  } finally {
    await platform.client.end();
  }
}

/** 清空並刪除 bucket；不存在就略過。 */
async function dropBucket(bucket: string): Promise<void> {
  const client = new S3Client({
    region: process.env.FILE_STORAGE_REGION || 'us-east-1',
    endpoint: process.env.FILE_STORAGE_ENDPOINT || 'http://127.0.0.1:9000/storage',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.FILE_STORAGE_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.FILE_STORAGE_SECRET_ACCESS_KEY ?? '',
    },
  });
  try {
    for (let token: string | undefined; ;) {
      // oxlint-disable-next-line no-await-in-loop -- 依序分頁
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).flatMap((object) =>
        object.Key ? [{ Key: object.Key }] : [],
      );
      if (keys.length) {
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
      }
      if (!page.IsTruncated) break;
      token = page.NextContinuationToken;
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    console.info(`已刪除 bucket ${bucket}`);
  } catch (error) {
    if ((error as { name?: string }).name === 'NoSuchBucket') {
      console.info(`bucket ${bucket} 不存在，略過`);
      return;
    }
    throw error;
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
