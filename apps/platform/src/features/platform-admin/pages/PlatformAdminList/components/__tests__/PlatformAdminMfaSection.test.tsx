import { AppError } from '@b2b-system/web-core/errors';
import { renderUnhydrated, renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { PlatformAdminMfaSection } from '../PlatformAdminMfaSection';

const { fetchStatus, resetMfa } = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  resetMfa: vi.fn(),
}));
vi.mock('@/apis/platform-admin/get-admin-mfa/fetcher', () => ({ fetchAdminMfaQuery: fetchStatus }));
vi.mock('@/apis/platform-admin/reset-admin-mfa/fetcher', () => ({
  fetchResetAdminMfaMutation: resetMfa,
}));

const ADMIN_ID = 'admin-2';
const CAN_RESET: PermissionKey[] = ['platformAdmin:read', 'platformAdmin:resetMfa'];

const ENABLED = {
  enabled: true,
  recoveryCodesRemaining: 8,
  factors: [
    {
      id: 'f1',
      method: 'totp',
      label: null,
      hint: null,
      available: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      lastUsedAt: null,
    },
  ],
};

function render(permissions: PermissionKey[], isSelf = false) {
  return renderWithPermissions(
    <PlatformAdminMfaSection adminId={ADMIN_ID} isSelf={isSelf} />,
    permissions,
  );
}

beforeAll(() => initTestI18n());

beforeEach(() => {
  fetchStatus.mockReset().mockResolvedValue(ENABLED);
  resetMfa.mockReset().mockResolvedValue({ success: true });
});

describe('PlatformAdminMfaSection（平台管理者的 MFA 與重設，docs/architecture/backend/21-mfa.md §8）', () => {
  it('有 platformAdmin:resetMfa → 顯示重設', async () => {
    render(CAN_RESET);
    expect(await screen.findByTestId('mfa-reset')).toBeInTheDocument();
    expect(fetchStatus.mock.calls[0]?.[0]).toMatchObject({ params: { id: ADMIN_ID } });
  });

  it('沒有 platformAdmin:resetMfa → 只看得到狀態，沒有重設', async () => {
    render(['platformAdmin:read', 'platformAdmin:update']);
    expect(await screen.findByTestId('mfa-status')).toHaveAttribute('data-value', 'true');
    expect(screen.queryByTestId('mfa-reset')).toBeNull();
  });

  it('權限未水合 → 不閃現重設', async () => {
    renderUnhydrated(<PlatformAdminMfaSection adminId={ADMIN_ID} isSelf={false} />);
    expect(await screen.findByTestId('mfa-status')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-reset')).toBeNull();
  });

  it('自己 → 即使有權限也不能重設（在個人資料頁管理）', async () => {
    render(CAN_RESET, true);
    expect(await screen.findByTestId('mfa-status')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-reset')).toBeNull();
  });

  it('確認重設 → 送出、提示完成並重新取得狀態', async () => {
    render(CAN_RESET);
    fireEvent.click(await screen.findByTestId('mfa-reset'));
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(resetMfa).toHaveBeenCalled());
    expect(resetMfa.mock.calls[0]?.[0]).toEqual({ params: { id: ADMIN_ID } });
    expect(await screen.findByTestId('toast')).toHaveTextContent('已重設 MFA。');
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2));
  });

  it('重設被拒絕（403）→ 顯示錯誤提示，不重新取得狀態', async () => {
    resetMfa.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    render(CAN_RESET);
    fireEvent.click(await screen.findByTestId('mfa-reset'));
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    expect(await screen.findByTestId('toast')).not.toHaveTextContent('已重設 MFA。');
    expect(fetchStatus).toHaveBeenCalledOnce();
  });
});
