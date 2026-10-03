import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './index';

describe('Switch', () => {
  it('點擊切換', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="啟用通知" onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole('switch', { name: '啟用通知' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('空白鍵切換（鍵盤操作）', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="啟用通知" onCheckedChange={onCheckedChange} />);
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalled();
  });

  it('disabled 時不切換', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="啟用通知" disabled onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('checked 反映在 aria-checked', () => {
    render(<Switch aria-label="啟用通知" checked />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});
