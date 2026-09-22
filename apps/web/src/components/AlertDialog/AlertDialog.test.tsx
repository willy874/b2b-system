import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AlertDialog } from './index';

function renderDialog(overrides: Partial<Parameters<typeof AlertDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <AlertDialog
      open
      onOpenChange={onOpenChange}
      title="刪除角色"
      description="此操作無法復原"
      confirmLabel="刪除"
      cancelLabel="取消"
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe('AlertDialog', () => {
  it('以 alertdialog 角色曝露標題與說明', () => {
    renderDialog();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('刪除角色')).toBeInTheDocument();
    expect(screen.getByText('此操作無法復原')).toBeInTheDocument();
  });

  it('確認按鈕觸發 onConfirm', async () => {
    const { onConfirm } = renderDialog();
    await userEvent.click(screen.getByTestId('alert-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('取消按鈕關閉對話框', async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.click(screen.getByTestId('alert-dialog-cancel'));
    expect(onOpenChange).toHaveBeenCalled();
  });

  it('loading 時兩個按鈕都不可按（避免重複送出）', async () => {
    const { onConfirm, onOpenChange } = renderDialog({ loading: true });

    // 取消鍵整個停用；確認鍵保留焦點（aria-disabled），否則送出當下焦點會掉回 <body>
    expect(screen.getByTestId('alert-dialog-cancel')).toBeDisabled();
    expect(screen.getByTestId('alert-dialog-confirm')).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await userEvent.click(screen.getByTestId('alert-dialog-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('關閉時不渲染', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
