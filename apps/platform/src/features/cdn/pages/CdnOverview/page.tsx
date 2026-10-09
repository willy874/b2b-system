import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getCdnOverviewQueryOptions } from '@/apis/platform-cdn/get-cdn-overview/query';

import { useCdnPermission } from '../../hooks/useCdnPermission';
import { DeploymentSection } from './components/DeploymentSection';
import { NodesSection } from './components/NodesSection';
import { PurgeSection } from './components/PurgeSection';
import { SettingsSection } from './components/SettingsSection';

/**
 * CDN（docs/architecture/backend/09-file.md §16.12）：部署（環境變數，唯讀）、設定（`cdn:update`）、邊緣節點（檢查只要 `cdn:read`）、
 * 清理（`cdn:purge`；整個快取另要 `cdn:purgeAll`）。這個部署沒有 CDN 時只顯示部署區塊與啟用的方式。
 */
export default function CdnOverviewPage() {
  const { t } = useTranslation();
  const { canUpdate, canPurge, canPurgeAll } = useCdnPermission();
  const overview = useQuery(getCdnOverviewQueryOptions());

  return (
    <div className="flex max-w-4xl flex-col gap-4" data-testid="cdn-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('cdn.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('cdn.description')}</p>
      </header>
      {overview.isPending ? (
        <Skeleton className="h-40" />
      ) : overview.isError ? (
        <QueryError error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <>
          <DeploymentSection deployment={overview.data.deployment} />
          {overview.data.settings && overview.data.effective && (
            <>
              <SettingsSection
                // 版本變了（自己或別人改過）就以新的存放值重設輸入框
                key={overview.data.settings.version}
                deployment={overview.data.deployment}
                settings={overview.data.settings}
                effective={overview.data.effective}
                canUpdate={canUpdate}
              />
              <NodesSection lastCheck={overview.data.lastCheck} />
              <PurgeSection
                targets={overview.data.purgeTargets}
                recent={overview.data.recentPurges}
                nodeCount={overview.data.lastCheck?.nodes.length ?? 0}
                canPurge={canPurge}
                canPurgeAll={canPurgeAll}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
