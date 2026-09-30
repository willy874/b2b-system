import { and, eq, isNull } from 'drizzle-orm';

import type { SecretBox } from '@/core/crypto';
import { isValidBucketName } from '@/core/storage/object-storage';

import type { PlatformScriptDatabase } from '../client';
import { tenantDomains, tenants } from './schema';

export interface TenantRegistration {
  code: string;
  name: string;
  databaseUrl: string;
  /** 物件儲存的 bucket（docs/adr/0020-physical-tenant-isolation.md D16）。 */
  storageBucket: string;
  domains: string[];
}

/**
 * 登記租戶（冪等）：同代碼的租戶不存在才建立；網域補上缺的，已屬於別的租戶的網域只警告。
 * 給 `db:migrate` 的預設租戶與整合測試用；正式的建立與佈建流程在交付順序第 4 步。
 */
export async function registerTenant(
  platform: PlatformScriptDatabase,
  registration: TenantRegistration,
  box: SecretBox,
): Promise<string> {
  if (!isValidBucketName(registration.storageBucket)) {
    throw new Error(`bucket 名稱 ${registration.storageBucket} 不符合 S3 命名規則`);
  }
  const [existing] = await platform
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.code, registration.code), isNull(tenants.deletedAt)))
    .limit(1);
  let tenantId = existing?.id;
  if (!tenantId) {
    const [created] = await platform
      .insert(tenants)
      .values({
        code: registration.code,
        name: registration.name,
        databaseUrlEncrypted: box.encrypt(registration.databaseUrl),
        storageBucket: registration.storageBucket,
      })
      .returning({ id: tenants.id });
    if (!created) throw new Error(`建立租戶 ${registration.code} 失敗`);
    tenantId = created.id;
    console.info(`已登記租戶 ${registration.code}`);
  }

  for (const raw of registration.domains) {
    const domain = raw.trim().toLowerCase();
    if (!domain) continue;
    // oxlint-disable-next-line no-await-in-loop -- 網域數量少
    const [owner] = await platform
      .select({ tenantId: tenantDomains.tenantId })
      .from(tenantDomains)
      .where(eq(tenantDomains.domain, domain))
      .limit(1);
    if (owner && owner.tenantId !== tenantId) {
      console.warn(`網域 ${domain} 已屬於另一個租戶，略過`);
      continue;
    }
    if (!owner) {
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await platform.insert(tenantDomains).values({ domain, tenantId }).onConflictDoNothing();
    }
  }
  return tenantId;
}
