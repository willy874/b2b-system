import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { featureStore, resetFeatureStore } from '../store';
import type { FeatureStatus } from '../store';
import { useFeatureGate } from '../useFeatureGate';

/** `/group/import` 同時屬於 group（`/group`）與 dataTransfer（`/group/import`），與 app 的 catalog 相同。 */
function setStatuses(statuses: Record<string, FeatureStatus>, resolved = true) {
  featureStore.setState({
    resolved,
    basePaths: new Map([
      ['group', ['/group']],
      ['dataTransfer', ['/data-transfer', '/group/import']],
    ]),
    statuses: new Map(Object.entries(statuses)),
  });
}

const gateOf = (pathname: string) => renderHook(() => useFeatureGate(pathname)).result.current;

describe('useFeatureGate（docs/architecture/frontend/02-plugin-system.md §9.2 D7）', () => {
  beforeEach(() => {
    resetFeatureStore();
  });

  it('不屬於任何可啟用 feature 的頁面 → open', () => {
    setStatuses({ group: 'disabled', dataTransfer: 'disabled' });
    expect(gateOf('/user')).toBe('open');
  });

  it('所屬的 feature 已安裝 → open', () => {
    setStatuses({ group: 'ready', dataTransfer: 'disabled' });
    expect(gateOf('/group/abc')).toBe('open');
  });

  it('同時屬於兩個 feature 的頁面：較具體的 dataTransfer 關閉 → disabled（即使 group 已安裝）', () => {
    setStatuses({ group: 'ready', dataTransfer: 'disabled' });
    expect(gateOf('/group/import')).toBe('disabled');
  });

  it('同時屬於兩個 feature 的頁面：上層的 group 關閉 → disabled', () => {
    setStatuses({ group: 'disabled', dataTransfer: 'ready' });
    expect(gateOf('/group/import')).toBe('disabled');
  });

  it('同時屬於兩個 feature 的頁面：兩個都已安裝 → open', () => {
    setStatuses({ group: 'ready', dataTransfer: 'ready' });
    expect(gateOf('/group/import')).toBe('open');
  });

  it('其中一個還在安裝 → pending；清單還沒到時未啟用也算 pending', () => {
    setStatuses({ group: 'ready', dataTransfer: 'installing' });
    expect(gateOf('/group/import')).toBe('pending');

    setStatuses({ group: 'ready', dataTransfer: 'disabled' }, false);
    expect(gateOf('/group/import')).toBe('pending');
  });

  it('其中一個安裝失敗 → failed', () => {
    setStatuses({ group: 'ready', dataTransfer: 'failed' });
    expect(gateOf('/group/import')).toBe('failed');
  });
});
