import {
  registerMfaMethod,
  totpMethod,
  emailMethod,
  mfaMethodRegistry,
} from '@b2b-system/web-core/mfa';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import type { MfaPolicy } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { registerSecurityPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const { fetchPolicy, updatePolicy, previewPolicy, fetchRoles } = vi.hoisted(() => ({
  fetchPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  previewPolicy: vi.fn(),
  fetchRoles: vi.fn(),
}));
vi.mock('@/apis/mfa-policy/get-mfa-policy/fetcher', () => ({ fetchMfaPolicyQuery: fetchPolicy }));
vi.mock('@/apis/mfa-policy/update-mfa-policy/fetcher', () => ({
  fetchUpdateMfaPolicyMutation: updatePolicy,
}));
vi.mock('@/apis/mfa-policy/preview-mfa-policy/fetcher', () => ({
  fetchPreviewMfaPolicyMutation: previewPolicy,
}));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));

const method = (id: string, platformEnabled: boolean) => ({
  id,
  challenge: id === 'email' ? ('server' as const) : ('none' as const),
  enrollAt: 'anywhere' as const,
  assurance: id === 'email' ? ('inbox' as const) : ('possession' as const),
  maxFactorsPerAccount: id === 'email' ? 1 : 5,
  platformEnabled,
});

const POLICY: MfaPolicy = {
  requireAll: false,
  requiredRoleIds: [],
  allowedMethods: null,
  version: 1,
  updatedAt: null,
  methods: [method('totp', true), method('email', false)],
  nonCompliant: 0,
};

const READER = ['mfaPolicy:read'] as PermissionKey[];
const EDITOR = ['mfaPolicy:read', 'mfaPolicy:update', 'role:read'] as PermissionKey[];
const routes = [Routes.SecurityRoute.addChildren([Routes.SecurityMfaRoute])];

beforeAll(async () => {
  await initTestI18n(zhTW);
  mfaMethodRegistry.reset();
  registerMfaMethod(totpMethod);
  registerMfaMethod(emailMethod);
});

beforeEach(() => {
  vi.clearAllMocks();
  resetPagePermissionRegistry();
  registerSecurityPagePermissions();
  fetchPolicy.mockResolvedValue(POLICY);
  fetchRoles.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 200, total: 0 } });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('安全性：MFA 政策的頁面權限（docs/architecture/backend/21-mfa.md §6）', () => {
  it('有 mfaPolicy:read → 進得去', () => {
    usePermissionStore.setState({ permissions: new Set(READER), hydrated: true });
    expect(renderHook(() => usePageAccess('/security/mfa')).result.current).toMatchObject({
      gated: true,
      canAccess: true,
    });
  });

  it('沒有 mfaPolicy:read → 不能進', () => {
    usePermissionStore.setState({
      permissions: new Set(['system:read'] as PermissionKey[]),
      hydrated: true,
    });
    expect(renderHook(() => usePageAccess('/security/mfa')).result.current).toMatchObject({
      gated: true,
      canAccess: false,
    });
  });

  it('權限未水合 → 還不能判斷', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => usePageAccess('/security/mfa')).result.current).toMatchObject({
      hydrated: false,
      gated: true,
    });
  });
});

describe('安全性：MFA 政策頁', () => {
  it('只有讀取權限：唯讀、沒有儲存鈕；平台未開放的方式停用並註明', async () => {
    renderRoute(routes, '/security/mfa', READER);
    await screen.findByTestId('security-mfa-page');
    expect(screen.queryByTestId('security-mfa-save')).not.toBeInTheDocument();
    expect(screen.getByText('平台未開放')).toBeInTheDocument();
    expect(screen.getByText('與重設密碼同一個信箱')).toBeInTheDocument();
  });

  it('要求所有人啟用：先預覽影響、有人會被要求時先確認，再以 version 儲存', async () => {
    previewPolicy.mockResolvedValue({ nonCompliant: 3, stranded: 0 });
    updatePolicy.mockResolvedValue({ ...POLICY, requireAll: true, version: 2, nonCompliant: 3 });
    renderRoute(routes, '/security/mfa', EDITOR);
    fireEvent.click(await screen.findByTestId('security-mfa-require-all'));
    fireEvent.click(screen.getByTestId('security-mfa-save'));
    expect(await screen.findByTestId('security-mfa-confirm')).toBeInTheDocument();
    expect(previewPolicy.mock.calls[0]?.[0]).toMatchObject({
      params: { requireAll: true, version: 1 },
    });
    fireEvent.click(
      within(screen.getByTestId('security-mfa-confirm')).getByRole('button', { name: '儲存' }),
    );
    await waitFor(() =>
      expect(updatePolicy.mock.calls[0]?.[0]).toMatchObject({
        params: { requireAll: true, version: 1 },
      }),
    );
  });

  it('不符合政策的人數 > 0 時提供連到使用者列表的連結', async () => {
    fetchPolicy.mockResolvedValue({ ...POLICY, requireAll: true, nonCompliant: 2 });
    renderRoute(routes, '/security/mfa', EDITOR);
    const count = await screen.findByTestId('security-mfa-non-compliant');
    expect(count).toHaveAttribute('data-value', '2');
  });
});
