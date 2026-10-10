import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import { QuerySection } from './QuerySection';
import type { QuerySectionState } from './QuerySection';
import { useOffsetClamp } from './useOffsetClamp';

function state(patch: Partial<QuerySectionState<string[]>>): QuerySectionState<string[]> {
  return { data: undefined, isError: false, error: null, refetch: vi.fn(), ...patch };
}

function renderSection(query: QuerySectionState<string[]>) {
  return render(
    <QuerySection query={query} data-testid="section-error">
      {(items) => (items.length ? <p>{items.join(',')}</p> : <p>無</p>)}
    </QuerySection>,
  );
}

beforeAll(() => initTestI18n());

describe('QuerySection（docs/architecture/frontend/07-ui-system.md §6.1）', () => {
  it('載入中顯示骨架，不顯示內容與「無」', () => {
    renderSection(state({}));
    expect(screen.getByTestId('query-section-loading')).toBeInTheDocument();
    expect(screen.queryByText('無')).not.toBeInTheDocument();
  });

  it('沒有資料又失敗時顯示錯誤與重試，不顯示「無」', async () => {
    const refetch = vi.fn();
    renderSection(state({ isError: true, error: new AppError('INTERNAL_ERROR', 500), refetch }));
    expect(screen.getByTestId('section-error')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('無')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('query-error-retry'));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('有資料時渲染內容；空清單由內容決定顯示「無」', () => {
    renderSection(state({ data: [] }));
    expect(screen.getByText('無')).toBeInTheDocument();
    expect(screen.queryByTestId('section-error')).not.toBeInTheDocument();
  });

  it('有舊資料又失敗時保留內容並提示', () => {
    renderSection(
      state({ data: ['a', 'b'], isError: true, error: new AppError('INTERNAL_ERROR', 500) }),
    );
    expect(screen.getByText('a,b')).toBeInTheDocument();
    expect(screen.getByTestId('section-error')).toHaveAttribute('data-stale', 'true');
  });
});

describe('useOffsetClamp', () => {
  it.each([
    // [total, offset, 預期]
    [50, 50, 0],
    [100, 100, 50],
    [0, 50, 0],
  ])('total %i、offset %i → 退回 %i', (total, offset, expected) => {
    const setOffset = vi.fn();
    renderHook(() => useOffsetClamp(total, offset, 50, setOffset));
    expect(setOffset).toHaveBeenCalledWith(expected);
  });

  it('offset 在範圍內或還沒有結果時不動', () => {
    const setOffset = vi.fn();
    renderHook(() => useOffsetClamp(51, 50, 50, setOffset));
    renderHook(() => useOffsetClamp(undefined, 50, 50, setOffset));
    expect(setOffset).not.toHaveBeenCalled();
  });
});
