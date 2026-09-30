import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext } from '../../schema/custom-types';

/**
 * 租戶的生命週期（docs/adr/0020-physical-tenant-isolation.md D12、D13）：
 * `provisioning` → `active`；佈建失敗停在 `failed`（可重試）；`disabled` 的網域回 503。
 */
export const tenantStatus = pgEnum('tenant_status', [
  'provisioning',
  'active',
  'disabled',
  'failed',
]);

/**
 * 租戶登記（平台 DB）。每個租戶有自己的 database；連線字串以 `TENANT_SECRET_KEY` 加密存放（D4），
 * 換叢集或換 DB 角色只要改這一欄。
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 租戶代碼：網址與「進入租戶」頁輸入的就是它（小寫英數與連字號）。 */
    code: citext('code').notNull(),
    name: text('name').notNull(),
    status: tenantStatus('status').notNull().default('active'),
    databaseUrlEncrypted: text('database_url_encrypted').notNull(),
    /**
     * 這個租戶的物件儲存 bucket（docs/adr/0020-physical-tenant-isolation.md D16）：檔案、縮圖、影像變體都在裡面，
     * 檔案維護的「沒有紀錄的物件」對帳也只看這個 bucket，不會碰到別的租戶的檔案。
     */
    storageBucket: text('storage_bucket').notNull(),
    /** 佈建時建立的第一位管理員（D12）；佈建重試時沿用。`db:migrate` 登記的租戶沒有。 */
    adminEmail: citext('admin_email'),
    adminName: text('admin_name'),
    /** 最近一次佈建失敗的原因（`failed` 時才有），給平台管理者看。 */
    provisionError: text('provision_error'),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
    /**
     * 是否允許租戶設定外部 IdP 連線（D22）：連線由租戶的管理者在 backstage 設定，平台只能開關。
     * 關掉時租戶不能新增或啟用連線，登入時也不走既有的連線。
     */
    allowExternalIdp: boolean('allow_external_idp').notNull().default(true),
    /**
     * 平台管理者為這個租戶啟用的 feature id（docs/adr/0021-runtime-feature-activation.md D8）。值域是
     * `core/tenant/tenant-features.ts` 的 `TENANT_FEATURES`；這一層不 import `core/`，所以預設值寫成字面量，
     * 新租戶與 migration 當下的既有租戶都啟用全部。讀取時濾掉不認得的值，不必加 CHECK 約束。
     */
    features: text('features')
      .array()
      .notNull()
      .default(sql`'{file,auditLog,job}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tenants_code_key')
      .on(t.code)
      .where(sql`${t.deletedAt} IS NULL`),
    // 刪除的租戶也算：bucket 可能還沒清掉，不能讓新租戶沿用
    uniqueIndex('tenants_storage_bucket_key').on(t.storageBucket),
  ],
);

/**
 * 租戶的網域（D2）：瀏覽器看到的 host。可以帶 port（`localhost:5173`），也可以只有主機名稱；
 * 解析時先比對 `host:port`，再比對主機名稱。一個網域只屬於一個租戶。
 */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    domain: citext('domain').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tenant_domains_tenant_idx').on(t.tenantId)],
);

export type TenantRow = typeof tenants.$inferSelect;
export type TenantStatus = (typeof tenantStatus.enumValues)[number];
