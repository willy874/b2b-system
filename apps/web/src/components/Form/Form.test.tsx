import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Field } from '../Field';
import { Input } from '../Input';
import { Form } from './index';

describe('Form', () => {
  it('送出時觸發 onSubmit', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <Form onSubmit={onSubmit}>
        <button type="submit">送出</button>
      </Form>,
    );
    await userEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('把後端回傳的欄位錯誤顯示在對應欄位上', () => {
    render(
      <Form errors={{ name: '角色名稱重複' }}>
        <Field name="name" label="名稱">
          <Input name="name" />
        </Field>
      </Form>,
    );
    expect(screen.getByText('角色名稱重複')).toBeInTheDocument();
  });

  it('透傳 className 與 data-testid', () => {
    render(
      <Form className="custom" data-testid="role-form">
        <span>內容</span>
      </Form>,
    );
    const form = screen.getByTestId('role-form');
    expect(form).toHaveClass('ge-form', 'custom');
  });
});
