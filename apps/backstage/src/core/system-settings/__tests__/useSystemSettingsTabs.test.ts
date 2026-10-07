import { usePermissionStore } from '@b2b-system/web-core/store';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '@/core/permission';

import { registerSystemSettingsTab, resetSystemSettingsTabs } from '../registry';
import { useSystemSettingsTabs } from '../useSystemSettingsTabs';

const GENERAL = definePageKey('TEST_GENERAL');
const SECURITY = definePageKey('TEST_SECURITY');

function hydrate(keys: string[]): void {
  usePermissionStore.setState({ permissions: new Set(keys as PermissionKey[]), hydrated: true });
}

describe('useSystemSettingsTabs（系統設定的分頁，docs/architecture/frontend/02-plugin-system.md §4.5）', () => {
  beforeEach(() => {
    resetSystemSettingsTabs();
    resetPagePermissionRegistry();
    registerPagePermission(GENERAL, {
      route: '/system/settings',
      rule: { access: ['system:read' as PermissionKey], match: PermissionMatch.EVERY },
    });
    registerPagePermission(SECURITY, {
      route: '/system/security',
      rule: { access: ['mfaPolicy:read' as PermissionKey], match: PermissionMatch.EVERY },
    });
    registerSystemSettingsTab({
      key: 'security',
      pageKey: SECURITY,
      to: '/system/security',
      labelKey: 'menu.security',
      order: 200,
    });
    registerSystemSettingsTab({
      key: 'general',
      pageKey: GENERAL,
      to: '/system/settings',
      labelKey: 'menu.settingGeneral',
      order: 100,
    });
  });

  it('依 order 排序，只列出有權限的分頁', () => {
    hydrate(['system:read', 'mfaPolicy:read']);
    const { result } = renderHook(() => useSystemSettingsTabs());
    expect(result.current.tabs.map((tab) => tab.key)).toEqual(['general', 'security']);

    hydrate(['mfaPolicy:read']);
    const { result: limited } = renderHook(() => useSystemSettingsTabs());
    expect(limited.current.tabs.map((tab) => tab.key)).toEqual(['security']);
  });

  it('權限未水合前是空陣列（不閃現分頁）', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    const { result } = renderHook(() => useSystemSettingsTabs());
    expect(result.current).toEqual({ hydrated: false, tabs: [] });
  });

  it('分頁的頁面鍵沒有登記（所屬 feature 未啟用）時不顯示；登記後跟著出現', () => {
    hydrate(['system:read', 'mfaPolicy:read']);
    resetPagePermissionRegistry();
    const dispose = registerPagePermission(SECURITY, {
      route: '/system/security',
      rule: { access: ['mfaPolicy:read' as PermissionKey], match: PermissionMatch.EVERY },
    });
    const { result } = renderHook(() => useSystemSettingsTabs());
    expect(result.current.tabs.map((tab) => tab.key)).toEqual(['security']);

    act(() => {
      registerPagePermission(GENERAL, {
        route: '/system/settings',
        rule: { access: ['system:read' as PermissionKey], match: PermissionMatch.EVERY },
      });
    });
    expect(result.current.tabs.map((tab) => tab.key)).toEqual(['general', 'security']);
    dispose();
  });
});
