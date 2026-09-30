import type { FeatureFlag } from '@/shared/api-sdk';

/** 頁面測試共用的 flag。 */
export function featureFlagFixture(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    key: 'levelEditor.v2',
    description: '新版關卡編輯器',
    defaultEnabled: false,
    owner: 'content',
    removeBy: '2099-12-31',
    globalState: null,
    tenantOverrides: { on: 2, off: 0 },
    ...overrides,
  };
}
