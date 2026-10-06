import { AllProviders, renderInRouter } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ApiToken } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

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

/** 對話框用到未儲存提醒（需要 router）：放進記憶體路由渲染。 */
async function renderDialog(props: Partial<ComponentProps<typeof ApiTokenCreateDialog>> = {}) {
  const onOpenChange = vi.fn();
  const result = renderInRouter(
    <ApiTokenCreateDialog
      open
      onOpenChange={onOpenChange}
      maxDays={90}
      onCreate={vi.fn()}
      {...props}
    />,
  );
  const nameInput = await screen.findByTestId('api-token-name-input');
  return { ...result, onOpenChange, nameInput };
}

describe('ApiTokenCreateDialog', () => {
  it('有效天數的選項不超過上限（個人 token 90 天）', async () => {
    await renderDialog();
    fireEvent.click(screen.getByTestId('api-token-lifetime-select'));
    const listbox = screen.getByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['7 天', '30 天', '90 天']);
  });

  it('建立失敗：錯誤顯示在對話框裡，不切到顯示 token', async () => {
    const { nameInput } = await renderDialog({
      onCreate: vi.fn().mockRejectedValue(new Error('boom')),
    });
    fireEvent.change(nameInput, { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('api-token-create-submit'));
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
    expect(screen.queryByTestId('api-token-value')).toBeNull();
  });

  it('建立成功後按 Esc：token 仍在畫面上；按「我已保存」才關閉（docs/architecture/06-external-api.md §9.2 D7）', async () => {
    const { onOpenChange, nameInput } = await renderDialog({
      onCreate: vi.fn().mockResolvedValue({ token: 'b2bt_secret', apiToken: token('a', 'active') }),
    });
    fireEvent.change(nameInput, { target: { value: '部署' } });
    fireEvent.click(screen.getByTestId('api-token-create-submit'));
    const value = await screen.findByTestId('api-token-value');

    fireEvent.keyDown(value, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('api-token-value')).toHaveTextContent('b2bt_secret');

    fireEvent.click(screen.getByTestId('api-token-done'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
  });

  describe('未儲存提醒（表單階段）', () => {
    it('輸入名稱後按 Esc：先確認；選「繼續編輯」後輸入還在', async () => {
      const { onOpenChange, nameInput } = await renderDialog();
      fireEvent.change(nameInput, { target: { value: '部署' } });
      fireEvent.keyDown(nameInput, { key: 'Escape' });

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByTestId('api-token-name-input')).toHaveValue('部署');
    });

    it('輸入名稱後按取消：選「放棄變更」才關閉', async () => {
      const { onOpenChange, nameInput } = await renderDialog();
      fireEvent.change(nameInput, { target: { value: '部署' } });
      fireEvent.click(screen.getByTestId('api-token-create-cancel'));

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });

    it('沒有輸入時按取消：直接關閉', async () => {
      const { onOpenChange } = await renderDialog();
      fireEvent.click(screen.getByTestId('api-token-create-cancel'));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });
  });
});
