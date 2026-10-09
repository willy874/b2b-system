import { AppContextProvider, createAppContext, GlobalEvents } from '@b2b-system/web-core/app';
import type { AppContext } from '@b2b-system/web-core/app';
import { sessionStore } from '@b2b-system/web-core/auth';
import { resetBatchOperations } from '@b2b-system/web-core/batch';
import {
  paletteCommandRegistry,
  resetCommandPaletteRegistry,
  searchProviderRegistry,
} from '@b2b-system/web-core/command-palette';
import { resetImagePickerRegistry } from '@b2b-system/web-core/image-picker';
import { navItemRegistry, resetNavigationRegistry } from '@b2b-system/web-core/navigation';
import { getPreferenceTables, resetPreferenceRegistry } from '@b2b-system/web-core/preference';
import { resetRouteLinkRegistry, routeLinkRegistry } from '@b2b-system/web-core/route-link';
import { createTestQueryClient } from '@b2b-system/web-core/testing';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { featureStore, resetFeatureStore } from '@/core/feature';
import { resetFileRegistry } from '@/core/file';
import { getRegisteredPageKeys, resetPagePermissionRegistry } from '@/core/permission';
import { getTrashTypes, resetTrashRegistry } from '@/core/trash';
import {
  ANNOUNCEMENT_CREATE_PAGE,
  ANNOUNCEMENT_MESSAGE_PAGE,
  ANNOUNCEMENT_PAGE,
} from '@/features/announcement';
import { APPROVAL_FLOW_PAGE } from '@/features/approval-flow';
import { AUDIT_LOG_PAGE } from '@/features/audit-log';
import { DATA_TRANSFER_PAGE } from '@/features/data-transfer';
import { FILE_PAGE } from '@/features/file';
import { GALLERY_PAGE } from '@/features/gallery';
import {
  GROUP_CREATE_PAGE,
  GROUP_IMPORT_PAGE,
  GROUP_MEMBER_IMPORT_PAGE,
  GROUP_PAGE,
} from '@/features/group';
import { IDENTITY_PROVIDER_PAGE } from '@/features/identity-provider';
import { JOB_PAGE } from '@/features/job';
import {
  ORG_UNIT_IMPORT_PAGE,
  ORG_UNIT_MEMBER_IMPORT_PAGE,
  ORG_UNIT_PAGE,
} from '@/features/organization';
import { SERVICE_ACCOUNT_CREATE_PAGE, SERVICE_ACCOUNT_PAGE } from '@/features/service-account';
import { SETTING_PAGE } from '@/features/system';
import { TRASH_PAGE } from '@/features/trash';
import { WEBHOOK_CREATE_PAGE, WEBHOOK_PAGE } from '@/features/webhook';
import { initTestI18n } from '@/test/i18n';

import { FEATURE_CATALOG, featureActivationPlugin, useSyncFeatures } from '../features';

/** 每個可啟用 feature 安裝後應該多出來的頁面鍵。 */
const EXPECTED_PAGES = {
  file: [FILE_PAGE],
  auditLog: [AUDIT_LOG_PAGE],
  job: [JOB_PAGE],
  trash: [TRASH_PAGE],
  systemSetting: [SETTING_PAGE],
  identityProvider: [IDENTITY_PROVIDER_PAGE],
  // 只控制帳號選單的一個項目，沒有頁面
  tenantSwitch: [],
  webhook: [WEBHOOK_PAGE, WEBHOOK_CREATE_PAGE],
  announcement: [ANNOUNCEMENT_PAGE, ANNOUNCEMENT_CREATE_PAGE, ANNOUNCEMENT_MESSAGE_PAGE],
  // 對外 API 在另一個程序，backstage 的頁面是服務帳號
  externalApi: [SERVICE_ACCOUNT_PAGE, SERVICE_ACCOUNT_CREATE_PAGE],
  // 匯入頁屬於群組自己的 feature（還要 dataTransfer 啟用才進得去）
  group: [GROUP_PAGE, GROUP_CREATE_PAGE, GROUP_IMPORT_PAGE, GROUP_MEMBER_IMPORT_PAGE],
  // 各資源的匯入頁屬於該資源的 feature（使用者、角色、標籤的匯入頁常駐登記），這裡只有「我的匯入匯出」
  dataTransfer: [DATA_TRANSFER_PAGE],
  organization: [ORG_UNIT_PAGE, ORG_UNIT_IMPORT_PAGE, ORG_UNIT_MEMBER_IMPORT_PAGE],
  approvalChain: [APPROVAL_FLOW_PAGE],
  gallery: [GALLERY_PAGE],
} satisfies Record<keyof typeof FEATURE_CATALOG, unknown[]>;

function createContext() {
  // feature 的 onInit 只用到 addResourceBundle；不必起整個 i18n plugin
  return createAppContext().use(() => ({
    name: 'i18n-stub',
    attrs: { addResourceBundle: () => () => undefined },
  }));
}

/**
 * 取代靜態表原本提供的編譯期完整性（docs/architecture/frontend/02-plugin-system.md §8 的代價緩解），並驗證卸載撤得乾淨
 * （docs/architecture/frontend/02-plugin-system.md §9.2 D12）。
 */
describe('可啟用 feature 的 catalog', () => {
  beforeEach(() => {
    resetPagePermissionRegistry();
    resetPreferenceRegistry();
    resetBatchOperations();
    resetFileRegistry();
    resetRouteLinkRegistry();
    resetNavigationRegistry();
    resetCommandPaletteRegistry();
    // 上一個案例最後重新安裝的 feature 沒有卸載：它登記的回收桶類型、route id、選圖的來源要清掉
    resetTrashRegistry();
    resetImagePickerRegistry();
  });

  it.each(Object.entries(EXPECTED_PAGES))(
    '%s：安裝後註冊自己的頁面，卸載後回到原狀，可以重新安裝',
    async (id, pages) => {
      const definition = FEATURE_CATALOG[id as keyof typeof FEATURE_CATALOG];
      const context = createContext();

      const name = await context.install(definition.plugin);
      expect(new Set(getRegisteredPageKeys())).toEqual(new Set(pages));

      // 側欄與命令面板的入口只指向自己的頁面
      expect(pages).toEqual(expect.arrayContaining(navItemRegistry.keys()));

      context.uninstall(name);
      expect(getRegisteredPageKeys()).toEqual([]);
      expect(getPreferenceTables()).toEqual([]);
      expect(navItemRegistry.keys()).toEqual([]);
      expect(searchProviderRegistry.keys()).toEqual([]);
      expect(paletteCommandRegistry.keys()).toEqual([]);

      await expect(context.install(definition.plugin)).resolves.toBe(name);
    },
  );

  it('file：安裝後登記 route id file.folder（通知連到資料夾）與命令面板的預覽連結，卸載後撤回——連結變成不可點（docs/architecture/backend/15-notification.md §12.2 D3）', async () => {
    const context = createContext();
    const name = await context.install(FEATURE_CATALOG.file.plugin);
    expect(routeLinkRegistry.keys()).toEqual([
      'file.folder',
      'file.preview',
      'file.folderPreview',
      'file.requestAccess',
    ]);

    context.uninstall(name);
    expect(routeLinkRegistry.keys()).toEqual([]);
  });

  it('webhook：安裝後登記 route id webhook.detail（自動停用的通知），卸載後撤回', async () => {
    const context = createContext();
    const name = await context.install(FEATURE_CATALOG.webhook.plugin);
    expect(routeLinkRegistry.keys()).toEqual(['webhook.detail']);

    context.uninstall(name);
    expect(routeLinkRegistry.keys()).toEqual([]);
  });

  it('announcement：安裝後登記 route id announcement.message 與回收桶的「公告」分頁，卸載後撤回', async () => {
    const context = createContext();
    const name = await context.install(FEATURE_CATALOG.announcement.plugin);
    expect(routeLinkRegistry.keys()).toEqual(['announcement.message']);
    expect(getTrashTypes().map((type) => type.type)).toEqual(['announcement']);

    context.uninstall(name);
    expect(routeLinkRegistry.keys()).toEqual([]);
    expect(getTrashTypes()).toEqual([]);
  });
});

function resetRegistries() {
  resetPagePermissionRegistry();
  resetPreferenceRegistry();
  resetBatchOperations();
  resetFileRegistry();
  resetRouteLinkRegistry();
  resetNavigationRegistry();
  resetCommandPaletteRegistry();
  resetTrashRegistry();
  resetImagePickerRegistry();
  resetFeatureStore();
}

/** 以假的 router 與 eventBus 建立安裝器；`pathname` 是目前頁面。 */
function setupActivator(pathname: string, options: { failInit?: boolean } = {}) {
  const router = {
    state: { location: { pathname } },
    navigate: vi.fn(() => Promise.resolve()),
    invalidate: vi.fn(() => Promise.resolve()),
  };
  const emit = vi.fn();
  const context = createAppContext()
    .use(() => ({
      name: 'stubs',
      attrs: {
        router,
        eventBus: { emit },
        addResourceBundle: () => {
          if (options.failInit) throw new Error('bundle');
          return () => undefined;
        },
      } as never,
    }))
    .use(featureActivationPlugin());
  return { features: context.features, router, emit };
}

describe('featureActivationPlugin（docs/architecture/frontend/02-plugin-system.md §9.2 D9）', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  beforeEach(resetRegistries);
  afterEach(resetRegistries);

  it('停在剛啟用的 feature 頁面（例：它的 404）時，安裝後讓 router 重新判斷', async () => {
    const { features, router } = setupActivator('/webhook/abc');
    await features.apply(['webhook']);
    expect(featureStore.getState().statuses.get('webhook')).toBe('ready');
    expect(router.invalidate).toHaveBeenCalledTimes(1);
  });

  it('目前頁面不屬於剛啟用的 feature 時不重新判斷', async () => {
    const { features, router } = setupActivator('/webhooks');
    await features.apply(['webhook']);
    expect(router.invalidate).not.toHaveBeenCalled();
  });

  it('停用目前頁面所屬的 feature → 提示並導回首頁後才卸載', async () => {
    const { features, router, emit } = setupActivator('/webhook');
    await features.apply(['webhook']);
    await features.apply([]);

    expect(emit).toHaveBeenCalledWith(GlobalEvents.TOAST_SHOW, {
      type: 'info',
      title: '目前的頁面所屬的功能已被停用',
    });
    expect(router.navigate).toHaveBeenCalledWith({ to: '/', replace: true, ignoreBlocker: true });
    expect(featureStore.getState().statuses.get('webhook')).toBe('disabled');
  });

  it('停用的 feature 不是目前頁面 → 不提示也不導頁', async () => {
    const { features, router, emit } = setupActivator('/user');
    await features.apply(['webhook']);
    await features.apply([]);

    expect(emit).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('安裝失敗 → 顯示錯誤提示，狀態是 failed', async () => {
    const { features, emit } = setupActivator('/', { failInit: true });
    await features.apply(['webhook']);

    expect(featureStore.getState().statuses.get('webhook')).toBe('failed');
    expect(emit).toHaveBeenCalledWith(GlobalEvents.TOAST_SHOW, {
      type: 'error',
      title: '功能載入失敗，請重新整理頁面',
    });
  });
});

function renderSync(profile: unknown, hasSession: boolean) {
  sessionStore.clear();
  if (hasSession) sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });
  const apply = vi.fn(() => Promise.resolve());
  const context = createAppContext().use(() => ({
    name: 'features-stub',
    attrs: { features: { apply } } as never,
  })) as AppContext;
  const queryClient = createTestQueryClient();
  // staleTime 內不會重取：直接放進快取，不必起 MSW
  queryClient.setQueryData([AUTH_PROFILE_QUERY_KEY], profile as never);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      AppContextProvider,
      { context } as ComponentProps<typeof AppContextProvider>,
      createElement(QueryClientProvider, { client: queryClient }, children),
    );
  renderHook(() => useSyncFeatures(), { wrapper });
  return apply;
}

describe('useSyncFeatures', () => {
  afterEach(() => sessionStore.clear());

  it('有 session 時把 profile 的啟用清單與 flag 交給安裝器', async () => {
    const apply = renderSync({ features: ['file'], flags: ['beta'] }, true);
    await waitFor(() => expect(apply).toHaveBeenCalledWith(['file'], ['beta']));
  });

  it('profile 尚未取得時不套用（不會把所有 feature 卸載）', () => {
    const apply = renderSync(undefined, false);
    expect(apply).not.toHaveBeenCalled();
  });
});
