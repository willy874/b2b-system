import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialogProvider, useConfirm } from './index';
import type { ConfirmOptions } from './index';

/** 按下「開啟」呼叫 confirm()，把回傳值交給 onResult。 */
function Trigger({
  options,
  onResult,
}: {
  options: ConfirmOptions;
  onResult: (confirmed: boolean) => void;
}) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={() => void confirm(options).then(onResult)}>
      開啟
    </button>
  );
}

async function openConfirm(options: Partial<ConfirmOptions> = {}) {
  const onResult = vi.fn();
  render(
    <ConfirmDialogProvider confirmLabel="確認" cancelLabel="取消">
      <Trigger options={{ title: '刪除項目？', ...options }} onResult={onResult} />
    </ConfirmDialogProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: '開啟' }));
  return { onResult };
}

describe('ConfirmDialog（useConfirm）', () => {
  it('呼叫 confirm() 時以 alertdialog 顯示標題與說明', async () => {
    await openConfirm({ description: '刪除後無法復原' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('刪除項目？')).toBeInTheDocument();
    expect(screen.getByText('刪除後無法復原')).toBeInTheDocument();
  });

  it('按確認回傳 true 並關閉', async () => {
    const { onResult } = await openConfirm();
    await userEvent.click(screen.getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('按取消回傳 false', async () => {
    const { onResult } = await openConfirm();
    await userEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('按 Esc 回傳 false', async () => {
    const { onResult } = await openConfirm();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('按鈕文案預設取自 Provider，呼叫端可覆寫', async () => {
    await openConfirm({ confirmLabel: '刪除' });
    expect(screen.getByTestId('alert-dialog-confirm')).toHaveTextContent('刪除');
    expect(screen.getByTestId('alert-dialog-cancel')).toHaveTextContent('取消');
  });

  it('onConfirm 執行期間兩個按鈕都不可按，完成後才回傳 true', async () => {
    let finish: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { onResult } = await openConfirm({ onConfirm });
    await userEvent.click(screen.getByTestId('alert-dialog-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('alert-dialog-cancel')).toBeDisabled();
    // 確認鈕是 loading：停用但保留焦點（aria-disabled），不是原生 disabled
    expect(screen.getByTestId('alert-dialog-confirm')).toHaveAttribute('aria-disabled', 'true');
    expect(onResult).not.toHaveBeenCalled();

    finish?.();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it('onConfirm 失敗時對話框留著，之後取消回傳 false', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'));
    const { onResult } = await openConfirm({ onConfirm });
    await userEvent.click(screen.getByTestId('alert-dialog-confirm'));

    await waitFor(() => expect(screen.getByTestId('alert-dialog-cancel')).toBeEnabled());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('data-testid 落在彈窗上', async () => {
    await openConfirm({ 'data-testid': 'item-delete-confirm' });
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-testid', 'item-delete-confirm');
  });

  it('不在 Provider 底下呼叫 useConfirm() 會丟錯', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger options={{ title: 'x' }} onResult={vi.fn()} />)).toThrow(
      'ConfirmDialogProvider',
    );
    consoleError.mockRestore();
  });
});
