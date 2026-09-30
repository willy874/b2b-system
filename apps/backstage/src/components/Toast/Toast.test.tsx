import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider, createToaster } from './index';
import type { Toaster } from './index';

function renderToaster(): Toaster {
  const toaster = createToaster();
  render(
    <ToastProvider toaster={toaster}>
      <p>內容</p>
    </ToastProvider>,
  );
  return toaster;
}

describe('Toast', () => {
  it('在元件樹外呼叫 toaster.show()，訊息會出現在 Provider 的 viewport', async () => {
    const toaster = renderToaster();
    act(() => {
      toaster.show({ type: 'success', title: '角色已建立' });
    });
    expect(await screen.findByText('角色已建立')).toBeVisible();
  });

  it('錯誤訊息可帶說明，並標記 error 類型', async () => {
    const toaster = renderToaster();
    act(() => {
      toaster.show({ type: 'error', title: '權限不足', description: '請聯絡管理員' });
    });
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('data-value', 'error');
    expect(toast).toHaveAttribute('data-type', 'error');
    expect(screen.getByText('請聯絡管理員')).toBeVisible();
  });

  it('沒給 type 時視為 info', async () => {
    const toaster = renderToaster();
    act(() => {
      toaster.show({ title: '已同步' });
    });
    expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'info');
  });

  it('可以手動關閉', async () => {
    const toaster = renderToaster();
    act(() => {
      toaster.show({ title: '角色已建立' });
    });
    await screen.findByText('角色已建立');
    await userEvent.click(screen.getByTestId('toast-close'));
    expect(screen.queryByText('角色已建立')).not.toBeInTheDocument();
  });

  it('可以用 show() 回傳的 id 關閉', async () => {
    const toaster = renderToaster();
    let id = '';
    act(() => {
      id = toaster.show({ title: '上傳中', timeout: 0 });
    });
    await screen.findByText('上傳中');
    act(() => toaster.close(id));
    await vi.waitFor(() => expect(screen.queryByText('上傳中')).not.toBeInTheDocument());
  });

  it('toaster 不是由 createToaster() 建立時直接報錯', () => {
    const fake: Toaster = { show: () => '', close: () => undefined };
    // React 會把 render 期間的錯誤再印一次；這裡要驗的是丟出的訊息，不是 console
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <ToastProvider toaster={fake}>
          <p>內容</p>
        </ToastProvider>,
      ),
    ).toThrow('createToaster()');
  });
});
