import { describe, expect, it } from 'vitest';

import { featureFlagFixture } from '../../../test-fixtures';
import { matchesFeatureFlagKeyword, toFeatureFlagRowVM } from '../adapter';

const TODAY = '2026-10-03';

describe('toFeatureFlagRowVM', () => {
  it('沒有全平台覆寫（null）→ globalState 為 default', () => {
    expect(toFeatureFlagRowVM(featureFlagFixture({ globalState: null }), TODAY).globalState).toBe(
      'default',
    );
  });

  it('有覆寫 → 原樣帶出', () => {
    expect(toFeatureFlagRowVM(featureFlagFixture({ globalState: 'off' }), TODAY).globalState).toBe(
      'off',
    );
  });

  it.each([
    { removeBy: '2026-10-02', expired: true },
    { removeBy: '2026-10-03', expired: false },
    { removeBy: '2099-12-31', expired: false },
  ])('removeBy $removeBy → expired $expired', ({ removeBy, expired }) => {
    expect(toFeatureFlagRowVM(featureFlagFixture({ removeBy }), TODAY).expired).toBe(expired);
  });
});

describe('matchesFeatureFlagKeyword（前端篩選）', () => {
  const row = toFeatureFlagRowVM(featureFlagFixture(), TODAY);

  it.each([
    { keyword: undefined, expected: true },
    { keyword: 'LEVELEDITOR', expected: true },
    { keyword: '關卡', expected: true },
    { keyword: 'content', expected: true },
    { keyword: 'billing', expected: false },
  ])('關鍵字 $keyword → $expected', ({ keyword, expected }) => {
    expect(matchesFeatureFlagKeyword(row, keyword)).toBe(expected);
  });
});
