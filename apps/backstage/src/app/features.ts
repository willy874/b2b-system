import { GlobalEvents, useAppContext } from '@b2b-system/web-core/app';
import type { AppDynamicPluginFactory, AppPluginFactory } from '@b2b-system/web-core/app';
import { useHasSession } from '@b2b-system/web-core/auth';
import { i18n } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { FeatureActivator } from '@/core/feature';
import type { FeatureDefinition } from '@/core/feature';
import {
  ANNOUNCEMENT_FEATURE,
  announcementFeaturePlugin,
  Routes as AnnouncementRoutes,
} from '@/features/announcement';
import {
  AUDIT_LOG_FEATURE,
  auditLogFeaturePlugin,
  Routes as AuditLogRoutes,
} from '@/features/audit-log';
import { FILE_FEATURE, fileFeaturePlugin, Routes as FileRoutes } from '@/features/file';
import {
  IDENTITY_PROVIDER_FEATURE,
  identityProviderFeaturePlugin,
  Routes as IdentityProviderRoutes,
} from '@/features/identity-provider';
import { JOB_FEATURE, jobFeaturePlugin, Routes as JobRoutes } from '@/features/job';
import {
  Routes as SystemRoutes,
  SYSTEM_SETTING_FEATURE,
  systemFeaturePlugin,
} from '@/features/system';
import { Routes as TrashRoutes, TRASH_FEATURE, trashFeaturePlugin } from '@/features/trash';
import { Routes as WebhookRoutes, WEBHOOK_FEATURE, webhookFeaturePlugin } from '@/features/webhook';
import type { Profile } from '@/shared/api-sdk';

export type TenantFeature = Profile['features'][number];

/**
 * 「切換租戶」（docs/architecture/05-tenancy.md §12.2 D6）：沒有頁面也沒有後端端點，只是使用者選單的一個項目
 * （`layouts/DashboardLayout.tsx`）。仍登記成一個空的 plugin，啟用與否就和其他 feature 一樣由安裝狀態表示。
 */
export const TENANT_SWITCH_FEATURE = 'tenantSwitch';

function tenantSwitchPlugin(): AppDynamicPluginFactory {
  return () => ({ name: 'tenant-switch' });
}

/**
 * 可啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D1）：由平台管理者對每個租戶開關，
 * 登入後依 `/auth/profile` 的 `features` 安裝。其餘 feature 是常駐的，照舊在 `main.tsx` 同步 `use()`。
 *
 * `satisfies Record<TenantFeature, …>`：後端新增可啟用的 feature 而這裡沒跟上時編譯失敗。
 * 每個 feature 的最上層 route 自己宣告 `beforeLoad: requireFeature(<id>)`（D6）；`routes` 列的就是那些 route。
 *
 * 以 feature flag 試行中的整個 feature 也登記在這裡（docs/architecture/05-tenancy.md §11.2 D9）：id 自取，
 * 宣告 `requires: { flag: '<key>' }`，其餘（`requireFeature`、`useFeatureGate`、卸載前導回首頁）照舊。
 */
export const FEATURE_CATALOG = {
  [FILE_FEATURE]: { plugin: fileFeaturePlugin(), routes: [FileRoutes.FileListRoute] },
  [AUDIT_LOG_FEATURE]: {
    plugin: auditLogFeaturePlugin(),
    routes: [AuditLogRoutes.AuditLogListRoute],
  },
  [JOB_FEATURE]: { plugin: jobFeaturePlugin(), routes: [JobRoutes.JobListRoute] },
  [TRASH_FEATURE]: { plugin: trashFeaturePlugin(), routes: [TrashRoutes.TrashListRoute] },
  [SYSTEM_SETTING_FEATURE]: {
    plugin: systemFeaturePlugin(),
    routes: [SystemRoutes.SettingListRoute],
  },
  [IDENTITY_PROVIDER_FEATURE]: {
    plugin: identityProviderFeaturePlugin(),
    routes: [IdentityProviderRoutes.IdentityProviderListRoute],
  },
  [TENANT_SWITCH_FEATURE]: { plugin: tenantSwitchPlugin(), routes: [] },
  [WEBHOOK_FEATURE]: { plugin: webhookFeaturePlugin(), routes: [WebhookRoutes.WebhookListRoute] },
  [ANNOUNCEMENT_FEATURE]: {
    plugin: announcementFeaturePlugin(),
    routes: [AnnouncementRoutes.AnnouncementListRoute, AnnouncementRoutes.AnnouncementMessageRoute],
  },
} as const satisfies Record<TenantFeature, FeatureDefinition> &
  Readonly<Record<string, FeatureDefinition>>;

/** 建立安裝器；卸載時要用到 router（`appContextPlugin` 建立），所以到執行期才讀 `app.router`。 */
export function featureActivationPlugin(): AppPluginFactory {
  return (context) => {
    const app = context.getInstance();
    const isViewing = (basePaths: readonly string[]) => {
      const { pathname } = app.router.state.location;
      return basePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
    };
    const activator = new FeatureActivator({
      context: app,
      catalog: FEATURE_CATALOG,
      // D9：先離開再卸載；未儲存提醒留不住（功能已經不能用），與 session 結束時一致
      beforeDisable: async (_id, basePaths) => {
        if (!isViewing(basePaths)) return;
        app.eventBus.emit(GlobalEvents.TOAST_SHOW, {
          type: 'info',
          title: i18n.t('app.featureDisabled'),
        });
        await app.router.navigate({ to: '/', replace: true, ignoreBlocker: true });
      },
      // 停在這個 feature 的 404 時重新跑 route 的 requireFeature，頁面才會出現
      afterEnable: (_id, basePaths) => {
        if (isViewing(basePaths)) void app.router.invalidate();
      },
      onInstallError: () => {
        app.eventBus.emit(GlobalEvents.TOAST_SHOW, {
          type: 'error',
          title: i18n.t('app.featureInstallFailed'),
        });
      },
    });

    return { name: 'feature-activation', attrs: { features: activator } };
  };
}

/**
 * 把 profile 的啟用清單與生效的 feature flag 交給安裝器。與 `useSyncPermissions` 用同一個 query：
 * 清單或 flag 變更時後端推播 `tenantFeature`，依賴圖讓 profile 重新取得（`apis/resources.ts`）。
 * 掛在 `app/App.tsx`，整個 app 只有一個實例。
 */
export function useSyncFeatures(): void {
  const { features } = useAppContext();
  const hasSession = useHasSession();
  const { data } = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });
  const enabled = data?.features;
  const flags = data?.flags;

  useEffect(() => {
    if (enabled) void features.apply(enabled, flags);
  }, [enabled, flags, features]);
}

declare module '@b2b-system/web-core/app/context' {
  interface AppPluginProperties {
    features: FeatureActivator;
  }
}
