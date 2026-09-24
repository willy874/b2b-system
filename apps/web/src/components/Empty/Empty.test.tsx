import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '../Button';
import { Empty } from './index';

describe('Empty', () => {
  it('顯示標題與說明', () => {
    render(<Empty title="沒有角色" description="建立第一個角色來開始" />);
    expect(screen.getByText('沒有角色')).toBeInTheDocument();
    expect(screen.getByText('建立第一個角色來開始')).toBeInTheDocument();
  });

  it('可以放操作按鈕', () => {
    render(<Empty title="沒有角色" action={<Button>建立角色</Button>} />);
    expect(screen.getByRole('button', { name: '建立角色' })).toBeInTheDocument();
  });

  it('沒有說明時不渲染說明段落', () => {
    render(<Empty title="沒有資料" testIds={{ description: 'empty-description' }} />);
    expect(screen.queryByTestId('empty-description')).toBeNull();
  });
});
