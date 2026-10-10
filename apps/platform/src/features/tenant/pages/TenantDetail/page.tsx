import { ButtonLink } from '@b2b-system/ui/Button';
import { Tabs } from '@b2b-system/ui/Tabs';
import { PageSkeleton, QueryBoundary } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getTenantQueryOptions } from '@/apis/platform-tenant/get-tenant/query';

import { TENANT_DETAIL_TAB_LABEL_KEY } from '../../constants';
import { useTenantPermission } from '../../hooks/useTenantPermission';
import { DEFAULT_TENANT_SEARCH, TenantDetailRoute, TenantListRoute } from '../../routes';
import type { TenantDetailTab } from '../../routes';
import { TenantDetailHeader } from './components/TenantDetailHeader';
import { TenantFeatures } from './components/TenantFeatures';
import { TenantFlags } from './components/TenantFlags';
import { TenantMfaMethods } from './components/TenantMfaMethods';
import { TenantNotices } from './components/TenantNotices';
import { TenantOverview } from './components/TenantOverview';
import { TenantUsage } from './components/TenantUsage';
import { useTenantDetailTab } from './useTenantDetailTab';

/**
 * 一個租戶（docs/architecture/05-tenancy.md §10.2 D12、D13）：佈建狀態與失敗原因、網域、用量（§5.4）、外部 IdP 與啟用的功能
 * （docs/architecture/frontend/02-plugin-system.md §9.2 D8）、停用與刪除。
 * 佈建中時詳情每 2 秒重抓一次（`getTenantQueryOptions`）。
 */
export default function TenantDetailPage() {
  const { t } = useTranslation();
  const { id } = TenantDetailRoute.useParams();
  const permission = useTenantPermission();
  const { tabs, active, setTab } = useTenantDetailTab();
  const query = useQuery(getTenantQueryOptions(id));
  const tenant = query.data;

  if (!tenant) {
    // 載入中、查詢失敗、租戶已刪除（重試也不會出現，只提供返回）
    return (
      <QueryBoundary
        query={query}
        skeleton={<PageSkeleton />}
        backAction={
          <ButtonLink
            to={TenantListRoute.to}
            search={DEFAULT_TENANT_SEARCH}
            data-testid="tenant-back"
          >
            {t('tenant.back')}
          </ButtonLink>
        }
        data-testid="tenant-not-found"
      >
        {() => null}
      </QueryBoundary>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-detail-page">
      <TenantDetailHeader tenant={tenant} permission={permission} />
      <TenantNotices tenant={tenant} />
      <Tabs
        moreLabel={t('common.more')}
        value={active}
        onValueChange={(value) => setTab(value as TenantDetailTab)}
        tabs={tabs.map((tab) => ({ value: tab, label: t(TENANT_DETAIL_TAB_LABEL_KEY[tab]) }))}
        data-testid="tenant-tabs"
      >
        <div className="pt-4" data-testid="tenant-tab-panel" data-value={active}>
          {active === 'overview' && (
            <TenantOverview tenant={tenant} canUpdate={permission.canUpdate} />
          )}
          {active === 'usage' && <TenantUsage tenantId={tenant.id} />}
          {active === 'features' && (
            <TenantFeatures tenant={tenant} canUpdate={permission.canUpdate} />
          )}
          {active === 'flags' && <TenantFlags tenant={tenant} canUpdate={permission.canUpdate} />}
          {active === 'mfa' && (
            <TenantMfaMethods tenant={tenant} canUpdate={permission.canUpdate} />
          )}
        </div>
      </Tabs>
    </div>
  );
}
