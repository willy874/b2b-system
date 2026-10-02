import { beforeEach, describe, expect, it } from 'vitest';

import { createAppContext } from '@/core/app';
import { resetBatchOperations } from '@/core/batch';
import { resetFileRegistry } from '@/core/file';
import { getRegisteredPageKeys, resetPagePermissionRegistry } from '@/core/permission';
import { getPreferenceTables, resetPreferenceRegistry } from '@/core/preference';
import { resetRouteLinkRegistry, routeLinkRegistry } from '@/core/route-link';
import { resetTrashRegistry } from '@/core/trash';
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
} satisfies Record<keyof typeof FEATURE_CATALOG, unknown[]>;

function createContext() {
  // feature 的 onInit 只用到 addResourceBundle；不必起整個 i18n plugin
  return createAppContext().use(() => ({
    name: 'i18n-stub',
    attrs: { addResourceBundle: () => () => undefined },
  }));
}

/**
 * 取代靜態表原本提供的編譯期完整性（ADR-0001 的代價緩解），並驗證卸載撤得乾淨
 * （docs/adr/0021-runtime-feature-activation.md D12）。
 */
describe('可啟用 feature 的 catalog', () => {
  beforeEach(() => {
    resetPagePermissionRegistry();
    resetPreferenceRegistry();
    resetBatchOperations();
    resetFileRegistry();
    resetRouteLinkRegistry();
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

      context.uninstall(name);
      expect(getRegisteredPageKeys()).toEqual([]);
      expect(getPreferenceTables()).toEqual([]);

      await expect(context.install(definition.plugin)).resolves.toBe(name);
    },
  );

  it('file：安裝後登記 route id file.folder（通知連到資料夾），卸載後撤回——連結變成不可點（ADR-0026 D3）', async () => {
    const context = createContext();
    const name = await context.install(FEATURE_CATALOG.file.plugin);
    expect(routeLinkRegistry.keys()).toEqual(['file.folder']);

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
});
