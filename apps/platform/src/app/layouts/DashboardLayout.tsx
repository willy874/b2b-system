import { BatchQueueNotifier } from '@b2b-system/web-core/batch';
import { DashboardShell } from '@b2b-system/web-core/layout';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { useLogoutMutation } from '@/features/login';

/**
 * 平台管理的外框：web-core 的 `DashboardShell` 接上這個 app 的選單與帳號選單。品牌下方標示「平台」，
 * 而不是租戶名稱：apps/platform 不屬於任何租戶（docs/architecture/05-tenancy.md §10.2 D2）。
 */
export function DashboardLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useLogoutMutation();
  const profile = useQuery(getAuthProfileQueryOptions());

  return (
    <DashboardShell
      // 品牌徽章取自產品名稱，與 backstage 一致
      brand={{
        mark: t('app.mark'),
        name: t('app.title'),
        context: { label: t('app.platform'), testId: 'current-realm' },
      }}
      userName={profile.data?.admin.displayName ?? ''}
      accountActions={[
        // 平台管理者也常要以租戶的身分看畫面：前往「進入租戶」輸入代碼（docs/architecture/05-tenancy.md §10.2 D11）
        {
          key: 'enterTenant',
          label: t('menu.enterTenant'),
          onSelect: () => void navigate({ to: '/enter' }),
        },
        {
          key: 'logout',
          label: t('menu.logout'),
          tone: 'danger',
          onSelect: () => logout.mutate(),
        },
      ]}
      // 批次工作結束時彈出結果（佇列只通知發起的分頁）
      afterContent={<BatchQueueNotifier />}
    >
      {children}
    </DashboardShell>
  );
}
