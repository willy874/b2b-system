import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import type { QuerySectionState } from '../QuerySection';
import { QueryBoundary } from './QueryBoundary';

function state(patch: Partial<QuerySectionState<string>>): QuerySectionState<string> {
  return { data: undefined, isError: false, error: null, refetch: vi.fn(), ...patch };
}

function renderBoundary(query: QuerySectionState<string>) {
  return render(
    <QueryBoundary
      query={query}
      skeleton={<p>載入中</p>}
      backAction={<button type="button">回到列表</button>}
      data-testid="detail-error"
    >
      {(name) => <h1>{name}</h1>}
    </QueryBoundary>,
  );
}

beforeAll(() => initTestI18n());

describe('QueryBoundary（以路由開啟的詳情）', () => {
  it('載入中顯示骨架；有資料顯示內容', () => {
    const { rerender } = renderBoundary(state({}));
    expect(screen.getByText('載入中')).toBeInTheDocument();
    rerender(
      <QueryBoundary query={state({ data: 'Editor' })}>{(name) => <h1>{name}</h1>}</QueryBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
  });

  it('失敗：錯誤訊息、重試與返回', async () => {
    const refetch = vi.fn();
    renderBoundary(state({ isError: true, error: new AppError('INTERNAL_ERROR', 500), refetch }));
    expect(screen.getByTestId('detail-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回到列表' })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('query-error-retry'));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('查無資料（已刪除）：只提供返回，不給重試', () => {
    renderBoundary(state({ isError: true, error: new AppError('ROLE_NOT_FOUND', 404) }));
    expect(screen.queryByTestId('query-error-retry')).toBeNull();
    expect(screen.getByRole('button', { name: '回到列表' })).toBeInTheDocument();
  });
});
