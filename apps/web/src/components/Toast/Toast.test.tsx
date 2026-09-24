import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from '../Button';
import { ToastProvider, useToast } from './index';

function Trigger() {
  const toast = useToast();
  return (
    <>
      <Button onClick={() => toast.success('角色已建立')}>成功</Button>
      <Button onClick={() => toast.error('權限不足', '請聯絡管理員')}>失敗</Button>
    </>
  );
}

function renderToast() {
  return render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  it('成功訊息會出現在畫面上', async () => {
    renderToast();
    await userEvent.click(screen.getByRole('button', { name: '成功' }));
    expect(await screen.findByText('角色已建立')).toBeVisible();
  });

  it('錯誤訊息可帶說明，並標記 error 類型', async () => {
    renderToast();
    await userEvent.click(screen.getByRole('button', { name: '失敗' }));
    expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'error');
    expect(screen.getByText('請聯絡管理員')).toBeVisible();
  });

  it('可以手動關閉', async () => {
    renderToast();
    await userEvent.click(screen.getByRole('button', { name: '成功' }));
    await screen.findByText('角色已建立');
    await userEvent.click(screen.getByTestId('toast-close'));
    expect(screen.queryByText('角色已建立')).not.toBeInTheDocument();
  });
});
