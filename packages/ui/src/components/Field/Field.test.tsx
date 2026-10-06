import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../Input';
import { ComponentLabelsContext, DEFAULT_COMPONENT_LABELS } from '../labels';
import { Field } from './index';

describe('Field', () => {
  it('label 與輸入元素連動（點 label 會聚焦）', () => {
    render(
      <Field label="角色名稱">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('角色名稱')).toBeInTheDocument();
  });

  it('required 顯示星號', () => {
    render(
      <Field label="角色名稱" required>
        <Input />
      </Field>,
    );
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });

  it('required 讓報讀器念出「必填」（星號本身不念）', () => {
    render(
      <Field label="角色名稱" required>
        <Input />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: '角色名稱 必填' })).toBeInTheDocument();
  });

  it('「必填」文字跟著 ComponentLabelsContext 換語系', () => {
    render(
      <ComponentLabelsContext value={{ ...DEFAULT_COMPONENT_LABELS, required: 'required' }}>
        <Field label="Name" required>
          <Input />
        </Field>
      </ComponentLabelsContext>,
    );
    expect(screen.getByRole('textbox', { name: 'Name required' })).toBeInTheDocument();
  });

  it('有錯誤時輸入元素標上 aria-invalid 並以 aria-describedby 連到訊息', () => {
    render(
      <Field label="角色名稱" error="名稱重複">
        <Input />
      </Field>,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('名稱重複');
  });

  it('有錯誤時顯示錯誤訊息並蓋掉說明文字', () => {
    render(
      <Field label="角色名稱" description="說明" error="名稱重複">
        <Input />
      </Field>,
    );
    expect(screen.getByText('名稱重複')).toBeInTheDocument();
    expect(screen.queryByText('說明')).not.toBeInTheDocument();
  });

  it('沒有錯誤時顯示說明文字', () => {
    render(
      <Field label="角色名稱" description="最多 64 字">
        <Input />
      </Field>,
    );
    expect(screen.getByText('最多 64 字')).toBeInTheDocument();
  });

  it('錯誤訊息預設 data-testid="field-error"，errorCode 放在 data-value', () => {
    render(
      <Field label="目前的密碼" error="密碼不正確" errorCode="AUTH_PASSWORD_MISMATCH">
        <Input />
      </Field>,
    );
    const error = screen.getByTestId('field-error');
    expect(error).toHaveTextContent('密碼不正確');
    expect(error).toHaveAttribute('data-value', 'AUTH_PASSWORD_MISMATCH');
  });

  it('testIds.error 覆寫錯誤訊息的 data-testid', () => {
    render(
      <Field label="名稱" error="名稱重複" testIds={{ error: 'role-name-error' }}>
        <Input />
      </Field>,
    );
    expect(screen.getByTestId('role-name-error')).toHaveTextContent('名稱重複');
  });
});
