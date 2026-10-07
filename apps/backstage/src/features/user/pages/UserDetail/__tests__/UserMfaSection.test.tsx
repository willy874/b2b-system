import { mfaMethodRegistry, registerMfaMethod, totpMethod } from '@b2b-system/web-core/mfa';
import { AllProviders } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../../locales/zh_TW.json';
import { UserMfaSection } from '../components/UserMfaSection';

const { fetchStatus, resetMfa } = vi.hoisted(() => ({ fetchStatus: vi.fn(), resetMfa: vi.fn() }));
vi.mock('@/apis/user/get-user-mfa/fetcher', () => ({ fetchUserMfaQuery: fetchStatus }));
vi.mock('@/apis/user/reset-user-mfa/fetcher', () => ({ fetchResetUserMfaMutation: resetMfa }));

const STATUS = {
  enabled: true,
  factors: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      method: 'totp',
      label: 'iPhone',
      hint: null,
      available: true,
      createdAt: '2026-10-07T00:00:00.000Z',
      lastUsedAt: null,
    },
  ],
  recoveryCodesRemaining: 8,
};

beforeAll(async () => {
  await initTestI18n(zhTW);
  mfaMethodRegistry.reset();
  registerMfaMethod(totpMethod);
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchStatus.mockResolvedValue(STATUS);
  resetMfa.mockResolvedValue({ success: true });
});

function renderSection(canReset: boolean) {
  render(
    <AllProviders>
      <UserMfaSection userId="u1" canReset={canReset} />
    </AllProviders>,
  );
}

describe('使用者詳情的兩步驟驗證（docs/architecture/backend/21-mfa.md §8）', () => {
  it('有 user:update（不是自己）→ 可以重設，先確認再送出', async () => {
    renderSection(true);
    expect(await screen.findByText('iPhone')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mfa-reset'));
    const dialog = await screen.findByTestId('mfa-reset-confirm');
    fireEvent.click(within(dialog).getByRole('button', { name: '重設 MFA' }));
    await waitFor(() => expect(resetMfa.mock.calls[0]?.[0]).toEqual({ params: { id: 'u1' } }));
  });

  it('只有 user:read（或是自己）→ 看得到，沒有重設鈕', async () => {
    renderSection(false);
    expect(await screen.findByText('iPhone')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-reset')).not.toBeInTheDocument();
  });

  it('還沒設定 → 沒有重設鈕', async () => {
    fetchStatus.mockResolvedValue({ enabled: false, factors: [], recoveryCodesRemaining: 0 });
    renderSection(true);
    expect(await screen.findByTestId('mfa-status')).toHaveAttribute('data-value', 'false');
    expect(screen.queryByTestId('mfa-reset')).not.toBeInTheDocument();
  });
});
