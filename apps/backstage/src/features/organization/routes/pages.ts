import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';
import { z } from 'zod';

import { requireFeature } from '@/core/feature';

import { ORGANIZATION_LOCALE_SCOPE } from '../locale';
import { OrganizationSearchSchema } from './model';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/backend/23-organization.md §6）。 */
export const ORGANIZATION_FEATURE = 'organization';

/** 左側部門樹、右側選中部門的詳情；選中的部門放在網址（`?unitId=`），可分享、上一頁回到前一個部門。 */
export const OrganizationRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/organization',
  staticData: { titleKey: 'menu.organization' },
  beforeLoad: requireFeature(ORGANIZATION_FEATURE),
  loader: localeScopeLoader(ORGANIZATION_LOCALE_SCOPE),
  validateSearch: OrganizationSearchSchema,
});

/** 匯入頁的網址：模式與已送出的傳輸（重新整理或從通知回來時直接顯示結果，docs/architecture/backend/22-data-transfer.md §7.2）。 */
export const OrgUnitImportSearchSchema = z.object({
  mode: z.enum(['create', 'update']).catch('create'),
  transfer: z.string().uuid().optional().catch(undefined),
});

/** 組織與 `dataTransfer` 都要啟用（任一個關閉時 404）。 */
async function requireImportFeatures(): Promise<void> {
  await requireFeature(ORGANIZATION_FEATURE)();
  await requireFeature('dataTransfer')();
}

/**
 * 部門匯入（docs/architecture/backend/22-data-transfer.md §12.3）：全頁，掛在根下（不是組織頁的子路由，也有自己的頁面權限）。
 * 上層可以引用同一份檔案裡的其他部門（§7.8）。
 */
export const OrgUnitImportRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/organization/import',
  staticData: { titleKey: 'menu.orgUnitImport' },
  beforeLoad: requireImportFeatures,
  loader: localeScopeLoader(ORGANIZATION_LOCALE_SCOPE),
  validateSearch: OrgUnitImportSearchSchema,
  search: { middlewares: [stripSearchParams({ mode: 'create' as const })] },
});

/** 部門成員匯入：新增成員資格、修改主管、主要部門與職稱。 */
export const OrgUnitMemberImportRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/organization/import-members',
  staticData: { titleKey: 'menu.orgUnitMemberImport' },
  beforeLoad: requireImportFeatures,
  loader: localeScopeLoader(ORGANIZATION_LOCALE_SCOPE),
  validateSearch: OrgUnitImportSearchSchema,
  search: { middlewares: [stripSearchParams({ mode: 'create' as const })] },
});
