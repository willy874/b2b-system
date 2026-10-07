import { describe, expect, it } from 'vitest';

import {
  FEATURE_FLAGS,
  catalogProblems,
  expiredFeatureFlags,
  pickKnownOverrides,
  resolveFeatureFlag,
  resolveToggle,
  toFeatureFlagOverrides,
} from '../feature-flags';
import type { FeatureFlagDefinition, FeatureFlagGlobalState } from '../feature-flags';

function flag(overrides: Partial<FeatureFlagDefinition> = {}): FeatureFlagDefinition {
  return {
    key: 'levelEditor.v2',
    description: '新版關卡編輯器',
    defaultEnabled: false,
    owner: 'content',
    removeBy: '2099-01-01',
    ...overrides,
  };
}

describe('resolveFeatureFlag 的優先順序（docs/architecture/05-tenancy.md §11.2 D3）', () => {
  it.each<[string, boolean, FeatureFlagGlobalState | undefined, boolean | undefined, boolean]>([
    ['都沒有 → 預設值（關）', false, undefined, undefined, false],
    ['都沒有 → 預設值（開）', true, undefined, undefined, true],
    ['只給試用租戶', false, undefined, true, true],
    ['全面開放', false, 'on', undefined, true],
    ['全面開放，但某個租戶先不要', false, 'on', false, false],
    ['緊急關閉，蓋過租戶層', false, 'off', true, false],
    ['緊急關閉，蓋過預設值', true, 'off', undefined, false],
  ])('%s', (_name, defaultEnabled, global, tenant, expected) => {
    expect(resolveFeatureFlag({ defaultEnabled }, global, tenant)).toBe(expected);
  });
});

describe('resolveToggle：feature flag 與 MFA 方式共用的兩級覆寫（docs/architecture/backend/21-mfa.md §5、D4）', () => {
  it.each<[FeatureFlagGlobalState | undefined, boolean | undefined, boolean, boolean]>([
    // 全平台、租戶、預設 → 生效
    ['off', true, true, false],
    [undefined, false, true, false],
    ['on', undefined, false, true],
    [undefined, undefined, true, true],
  ])('全平台 %s、租戶 %s、預設 %s → %s', (global, tenant, defaultEnabled, expected) => {
    expect(resolveToggle(defaultEnabled, global, tenant)).toBe(expected);
  });
});

describe('toFeatureFlagOverrides', () => {
  it('只留布林值', () => {
    expect(
      toFeatureFlagOverrides({ 'a.b': true, 'c.d': false, 'e.f': 'yes', 'g.h': null }),
    ).toEqual({
      'a.b': true,
      'c.d': false,
    });
  });

  it('不是物件 → 空的覆寫', () => {
    expect(toFeatureFlagOverrides(null)).toEqual({});
    expect(toFeatureFlagOverrides(['a.b'])).toEqual({});
    expect(toFeatureFlagOverrides('x')).toEqual({});
  });
});

describe('pickKnownOverrides', () => {
  it('只留目錄裡的 key，依目錄的順序', () => {
    const catalog = [flag({ key: 'b.one' }), flag({ key: 'a.two' })];
    const picked = pickKnownOverrides(
      { 'a.two': false, 'gone.flag': true, 'b.one': true },
      catalog,
    );
    expect(Object.entries(picked)).toEqual([
      ['b.one', true],
      ['a.two', false],
    ]);
  });
});

describe('catalogProblems', () => {
  it('格式正確的目錄沒有問題', () => {
    expect(catalogProblems([flag(), flag({ key: 'user.bulkInvite' })])).toEqual([]);
  });

  it('key 格式、重複、removeBy 格式都會被抓出來', () => {
    expect(
      catalogProblems([
        flag({ key: 'NoDot' }),
        flag({ key: 'user.bulkInvite' }),
        flag({ key: 'user.bulkInvite' }),
        flag({ key: 'user.other', removeBy: '2026/12/31' }),
      ]),
    ).toEqual([
      'NoDot：key 要是 <模組>.<名稱>（camelCase）',
      'user.bulkInvite：key 重複',
      'user.other：removeBy 要是 YYYY-MM-DD',
    ]);
  });
});

describe('expiredFeatureFlags', () => {
  it('removeBy 早於今天的才算到期（當天還不算）', () => {
    const catalog = [
      flag({ key: 'a.past', removeBy: '2026-09-29' }),
      flag({ key: 'a.today', removeBy: '2026-09-30' }),
      flag({ key: 'a.future', removeBy: '2026-10-01' }),
    ];
    expect(expiredFeatureFlags(catalog, '2026-09-30').map((f) => f.key)).toEqual(['a.past']);
  });
});

describe('目錄（core/feature-flags/feature-flags.ts）', () => {
  it('格式正確', () => {
    expect(catalogProblems(FEATURE_FLAGS)).toEqual([]);
  });

  /**
   * 暫時的開關一定要被移除（docs/architecture/05-tenancy.md §11.2 D11）。這個測試失敗時：移除 flag（D12），
   * 或者確定要延期就改 `removeBy`——延期會留在 commit 紀錄裡。
   */
  it('沒有過了 removeBy 還留著的 flag', () => {
    const today = new Date().toISOString().slice(0, 10);
    const expired = expiredFeatureFlags(FEATURE_FLAGS, today).map(
      (f) => `${f.key}（${f.owner}，${f.removeBy}）`,
    );
    expect(expired, `以下 flag 已過 removeBy，請移除或延期：${expired.join('、')}`).toEqual([]);
  });
});
