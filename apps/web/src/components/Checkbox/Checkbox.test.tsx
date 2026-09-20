import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './index';

describe('Checkbox', () => {
  it('點擊標籤即可切換', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="檢視使用者" onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByText('檢視使用者'));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('空白鍵可以切換（鍵盤操作）', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="檢視使用者" onCheckedChange={onCheckedChange} />);
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('disabled 時不會切換', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox disabled aria-label="檢視使用者" onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('checked 狀態反映在 aria-checked 上', () => {
    render(<Checkbox checked aria-label="檢視使用者" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });
});
