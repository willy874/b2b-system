import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../Input';
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
});
