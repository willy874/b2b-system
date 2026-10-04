import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PasswordInput } from '../PasswordInput';

function renderInput(props: Partial<Parameters<typeof PasswordInput>[0]> = {}) {
  render(<PasswordInput aria-label="password" data-testid="pw" {...props} />);
  return screen.getByTestId('pw');
}

describe('PasswordInput（登入表單的密碼欄）', () => {
  it('預設隱藏，按切換鈕顯示、再按一次隱藏', () => {
    const input = renderInput();
    const toggle = screen.getByTestId('password-visibility-toggle');
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('切換鈕不會送出表單', () => {
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form onSubmit={(event) => submit(event.nativeEvent as SubmitEvent)}>
        <PasswordInput aria-label="password" />
      </form>,
    );
    fireEvent.click(screen.getByTestId('password-visibility-toggle'));
    expect(submit).not.toHaveBeenCalled();
  });

  it('開著 Caps Lock 輸入時提示；關掉或離開欄位就消失', () => {
    const onKeyDown = vi.fn();
    const onBlur = vi.fn();
    const input = renderInput({ onKeyDown, onBlur });
    expect(screen.queryByTestId('caps-lock-hint')).toBeNull();

    fireEvent.keyDown(input, { key: 'A', modifierCapsLock: true });
    expect(screen.getByTestId('caps-lock-hint')).toBeInTheDocument();
    expect(onKeyDown).toHaveBeenCalled();

    fireEvent.keyUp(input, { key: 'a', modifierCapsLock: false });
    expect(screen.queryByTestId('caps-lock-hint')).toBeNull();

    fireEvent.keyDown(input, { key: 'A', modifierCapsLock: true });
    fireEvent.blur(input);
    expect(screen.queryByTestId('caps-lock-hint')).toBeNull();
    expect(onBlur).toHaveBeenCalled();
  });
});
