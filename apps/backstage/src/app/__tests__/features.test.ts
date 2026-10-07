import { createAppContext } from '@b2b-system/web-core/app';
import { resetBatchOperations } from '@b2b-system/web-core/batch';
import {
  paletteCommandRegistry,
  resetCommandPaletteRegistry,
  searchProviderRegistry,
} from '@b2b-system/web-core/command-palette';
import { navItemRegistry, resetNavigationRegistry } from '@b2b-system/web-core/navigation';
import { getPreferenceTables, resetPreferenceRegistry } from '@b2b-system/web-core/preference';
import { resetRouteLinkRegistry, routeLinkRegistry } from '@b2b-system/web-core/route-link';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetFileRegistry } from '@/core/file';
import { getRegisteredPageKeys, resetPagePermissionRegistry } from '@/core/permission';
import { getTrashTypes, resetTrashRegistry } from '@/core/trash';
import {
  ANNOUNCEMENT_CREATE_PAGE,
  ANNOUNCEMENT_MESSAGE_PAGE,
  ANNOUNCEMENT_PAGE,
} from '@/features/announcement';
import { AUDIT_LOG_PAGE } from '@/features/audit-log';
import { FILE_PAGE } from '@/features/file';
import { IDENTITY_PROVIDER_PAGE } from '@/features/identity-provider';
import { JOB_PAGE } from '@/features/job';
import { SETTING_PAGE } from '@/features/system';
import { TRASH_PAGE } from '@/features/trash';
import { WEBHOOK_CREATE_PAGE, WEBHOOK_PAGE } from '@/features/webhook';

import { FEATURE_CATALOG } from '../features';

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
  // 對外 API 在另一個程序，backstage 只依它顯示 token 列表的提示
  externalApi: [],
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
    // 上一個案例最後重新安裝的 feature 沒有卸載：它登記的回收桶類型、route id 要清掉
    resetTrashRegistry();
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
    expect(routeLinkRegistry.keys()).toEqual(['file.folder', 'file.preview', 'file.folderPreview']);

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
