import { AllProviders } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../../locales/zh_TW.json';
import { UserIdentitySection } from '../components/UserIdentitySection';

const { fetchIdentities, unlinkIdentity } = vi.hoisted(() => ({
  fetchIdentities: vi.fn(),
  unlinkIdentity: vi.fn(),
}));
vi.mock('@/apis/user/get-user-identities/fetcher', () => ({
  fetchUserIdentitiesQuery: fetchIdentities,
}));
vi.mock('@/apis/user/unlink-user-identity/fetcher', () => ({
  fetchUnlinkUserIdentityMutation: unlinkIdentity,
}));

const IDENTITY = {
  id: '55555555-5555-4555-8555-555555555555',
  providerId: '66666666-6666-4666-8666-666666666666',
  providerName: 'Corp ADFS',
  protocol: 'saml' as const,
  providerDeleted: false,
  subject: 'persistent-id-1',
  email: 'alice@corp.test',
  linkedAt: '2026-10-09T00:00:00.000Z',
  lastLoginAt: null,
};

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  fetchIdentities.mockResolvedValue({ items: [IDENTITY] });
  unlinkIdentity.mockResolvedValue(undefined);
});

function renderSection(canUnlink: boolean) {
  render(
    <AllProviders>
      <UserIdentitySection userId="u1" canUnlink={canUnlink} />
    </AllProviders>,
  );
}

describe('使用者詳情的外部身分（docs/architecture/04-sso.md §3.3.4）', () => {
  it('列出連線、協定與外部識別碼', async () => {
    renderSection(false);
    expect(await screen.findByText('Corp ADFS')).toBeInTheDocument();
    expect(screen.getByText('SAML 2.0')).toBeInTheDocument();
    expect(screen.getByText('persistent-id-1')).toBeInTheDocument();
  });

  it('有 user:update → 先確認再解除', async () => {
    renderSection(true);
    fireEvent.click(await screen.findByTestId('user-identity-unlink'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '解除連結' }));
    await waitFor(() =>
      expect(unlinkIdentity.mock.calls[0]?.[0]).toMatchObject({
        params: { userId: 'u1', identityId: IDENTITY.id },
      }),
    );
  });

  it('只有 user:read → 沒有解除鈕', async () => {
    renderSection(false);
    expect(await screen.findByText('Corp ADFS')).toBeInTheDocument();
    expect(screen.queryByTestId('user-identity-unlink')).not.toBeInTheDocument();
  });

  it('沒有連結 → 顯示空狀態', async () => {
    fetchIdentities.mockResolvedValue({ items: [] });
    renderSection(true);
    expect(await screen.findByText('沒有連結任何外部身分')).toBeInTheDocument();
  });
});
