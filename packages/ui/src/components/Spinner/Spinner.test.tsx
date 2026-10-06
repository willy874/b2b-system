import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ComponentLabelsContext, DEFAULT_COMPONENT_LABELS } from '../labels';
import { Spinner } from './index';

describe('Spinner', () => {
  it('以 status 角色曝露載入狀態', () => {
    render(<Spinner />);
    expect(screen.getByRole('status', { name: '載入中' })).toBeInTheDocument();
  });

  it('沒有傳 label 時用 ComponentLabelsContext 的文案（目前語系）', () => {
    render(
      <ComponentLabelsContext value={{ ...DEFAULT_COMPONENT_LABELS, loading: 'Loading…' }}>
        <Spinner />
      </ComponentLabelsContext>,
    );
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  });

  it('可自訂標籤與尺寸', () => {
    render(<Spinner label="載入角色中" size={32} data-testid="spinner" />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner).toHaveAccessibleName('載入角色中');
    expect(spinner).toHaveStyle({ width: '32px' });
  });
});
