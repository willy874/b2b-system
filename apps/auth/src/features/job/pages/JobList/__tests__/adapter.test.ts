import { describe, expect, it } from 'vitest';

import { jobFixture } from '../../../test-fixtures';
import { toJobRowVM } from '../adapter';

const NOW = new Date('2026-09-29T12:00:00.000Z');

describe('toJobRowVM', () => {
  it.each([
    ['平台層級 → platform', { tenantId: null, tenantCode: null }, 'platform'],
    ['租戶 → 代碼', {}, 'acme'],
    ['租戶已刪除 → 退回 id', { tenantCode: null }, '44444444-4444-4444-8444-444444444444'],
  ] as const)('%s', (_, overrides, ownerValue) => {
    expect(toJobRowVM(jobFixture(overrides), { canRetry: false }, NOW).ownerValue).toBe(ownerValue);
  });

  it('只有 failed 且持有重試權限才能重試', () => {
    expect(toJobRowVM(jobFixture(), { canRetry: true }, NOW).canRetry).toBe(true);
    expect(toJobRowVM(jobFixture(), { canRetry: false }, NOW).canRetry).toBe(false);
    expect(toJobRowVM(jobFixture({ state: 'completed' }), { canRetry: true }, NOW).canRetry).toBe(
      false,
    );
  });

  it('等待中且排定在未來才有 scheduledAt；狀態對應 Chip 色調', () => {
    const vm = toJobRowVM(
      jobFixture({ state: 'retry', startAfter: '2026-09-29T13:00:00.000Z', completedOn: null }),
      { canRetry: false },
      NOW,
    );
    expect(vm.scheduledAt).toEqual(new Date('2026-09-29T13:00:00.000Z'));
    expect(vm.stateTone).toBe('warning');
    expect(toJobRowVM(jobFixture(), { canRetry: false }, NOW).scheduledAt).toBeNull();
  });
});
