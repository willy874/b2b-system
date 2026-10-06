import type { MenuItemDescriptor } from '@b2b-system/ui/Menu';
import { BatchQueueNotifier } from '@b2b-system/web-core/batch';
import { DashboardShell } from '@b2b-system/web-core/layout';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getCurrentTenantQueryOptions } from '@/apis/tenant/get-current-tenant/query';
import { useIsFeatureReady } from '@/core/feature';
import { useLogoutMutation } from '@/features/auth';
import { ENV } from '@/shared/constants/env';

import { TENANT_SWITCH_FEATURE } from '../features';
import { ACCOUNT_PAGES, NAV_GROUPS, NAV_TOP_ITEMS } from './navigation';

/**
 * 換租戶＝換網域：回到 apps/platform 的「進入租戶」輸入代碼（docs/architecture/05-tenancy.md §10.2 D11）。
 * 平台管理者可對租戶關閉這個項目（`tenantSwitch`，docs/architecture/05-tenancy.md §12.2 D6）。
 */
const SWITCH_TENANT_URL = `${ENV.PLATFORM_APP_URL}/enter`;

/** 租戶後台的外框：web-core 的 `DashboardShell` 接上這個 app 的選單、目前的租戶與帳號選單。 */
export function DashboardLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const logout = useLogoutMutation();
  const profile = useQuery(getAuthProfileQueryOptions());
  const tenant = useQuery(getCurrentTenantQueryOptions());
  const canSwitchTenant = useIsFeatureReady(TENANT_SWITCH_FEATURE);
  const tenantName = tenant.data?.name;

  const switchTenant: MenuItemDescriptor[] = canSwitchTenant
    ? [
        {
          key: 'switchTenant',
          label: t('menu.switchTenant'),
          onSelect: () => globalThis.location.assign(SWITCH_TENANT_URL),
        },
      ]
    : [];

  return (
    <DashboardShell
      brand={{
        // 品牌徽章取自產品名稱而非租戶名稱：apps/platform 沒有租戶，兩邊才會一致；租戶名稱另外顯示在下方
        mark: t('app.mark'),
        name: t('app.title'),
        // 目前在哪個租戶：同時管理多個租戶的人才不會在錯的地方刪人
        context: tenantName ? { label: tenantName, testId: 'current-tenant' } : undefined,
      }}
      navTopItems={NAV_TOP_ITEMS}
      navGroups={NAV_GROUPS}
      userName={profile.data?.user.displayName ?? ''}
      accountPages={ACCOUNT_PAGES}
      accountActions={[
        ...switchTenant,
        { key: 'logout', label: t('menu.logout'), tone: 'danger', onSelect: () => logout.mutate() },
      ]}
      // 批次工作結束時彈出結果（佇列只通知發起的分頁）
      afterContent={<BatchQueueNotifier />}
    >
      {children}
    </DashboardShell>
  );
}
