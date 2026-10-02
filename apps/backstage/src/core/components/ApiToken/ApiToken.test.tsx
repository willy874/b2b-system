import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ApiToken } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';
import { AllProviders } from '@/test/renderWithPermissions';

import { ApiTokenCreateDialog } from './ApiTokenCreateDialog';
import { ApiTokenTable } from './ApiTokenTable';

beforeAll(() => initTestI18n());

const token = (id: string, status: ApiToken['status']): ApiToken => ({
  id,
  name: `token-${id}`,
  prefix: `b2bt_acme_${id}`,
  scopes: null,
  status,
  expiresAt: '2026-11-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: status === 'revoked' ? '2026-10-02T00:00:00.000Z' : null,
  createdAt: '2026-10-01T00:00:00.000Z',
  createdBy: null,
});

describe('ApiTokenTable（docs/architecture/06-external-api.md §9）', () => {
  it('每把 token 顯示狀態；已撤銷的沒有撤銷按鈕', () => {
    render(
      <ApiTokenTable
        tokens={[token('a', 'active'), token('b', 'revoked'), token('c', 'invalidated')]}
        canRevoke
        onRevoke={vi.fn()}
      />,
      { wrapper: AllProviders },
    );
    const statuses = screen.getAllByTestId('api-token-status').map((chip) => chip.dataset.value);
    expect(statuses).toEqual(['active', 'revoked', 'invalidated']);
    const revocable = screen
      .getAllByTestId('api-token-revoke-button')
      .map((button) => button.dataset.value);
    expect(revocable).toEqual(['a', 'c']);
  });

  it('不能撤銷時沒有任何撤銷按鈕', () => {
    render(<ApiTokenTable tokens={[token('a', 'active')]} canRevoke={false} onRevoke={vi.fn()} />, {
      wrapper: AllProviders,
    });
    expect(screen.queryByTestId('api-token-revoke-button')).toBeNull();
  });
});

describe('ApiTokenCreateDialog', () => {
  it('有效天數的選項不超過上限（個人 token 90 天）', () => {
    render(<ApiTokenCreateDialog open onOpenChange={vi.fn()} maxDays={90} onCreate={vi.fn()} />, {
      wrapper: AllProviders,
    });
    fireEvent.click(screen.getByTestId('api-token-lifetime-select'));
    const listbox = screen.getByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['7 天', '30 天', '90 天']);
  });

  it('建立失敗：錯誤顯示在對話框裡，不切到顯示 token', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('boom'));
    render(<ApiTokenCreateDialog open onOpenChange={vi.fn()} maxDays={90} onCreate={onCreate} />, {
      wrapper: AllProviders,
    });
    fireEvent.change(screen.getByTestId('api-token-name-input'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('api-token-create-submit'));
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
    expect(screen.queryByTestId('api-token-value')).toBeNull();
  });
});
