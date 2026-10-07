import type { TableColumnDef } from '@b2b-system/ui/Table';
import { screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '../../testing/i18n';
import { renderWithPermissions } from '../../testing/renderWithPermissions';
import { JobTable } from '../JobTable';
import type { JobRowVM } from '../types';
import { ROW } from './fixtures';

beforeAll(() => initTestI18n());

const PAGINATION = { offset: 0, limit: 50, total: 1, onChange: vi.fn() };
const FILTERS = { fields: [], value: {}, onSubmit: vi.fn() };

function renderTable(extraColumns?: Array<TableColumnDef<JobRowVM>>, expandedId?: string) {
  renderWithPermissions(
    <JobTable
      items={[ROW]}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      expandedId={expandedId}
      onToggleExpand={vi.fn()}
      filters={FILTERS}
      pagination={PAGINATION}
      renderDetail={(row) => <p data-testid="detail">{row.id}</p>}
      onRetryJob={vi.fn()}
      extraColumns={extraColumns}
    />,
  );
}

describe('JobTable（背景工作的列表）', () => {
  it('狀態以 Chip 顯示，testid 帶 data-value；沒有語系鍵的工作顯示名稱本身', () => {
    renderTable();
    const table = screen.getByTestId('job-table');
    expect(within(table).getByTestId('job-state')).toHaveAttribute('data-value', 'failed');
    expect(within(table).getByTestId('job-state')).toHaveTextContent('失敗');
    expect(table).toHaveTextContent('file.maintenance');
    expect(table).toHaveTextContent('2 / 2');
  });

  it('extraColumns 插在「工作」欄之後', () => {
    renderTable([{ id: 'tenant', header: '租戶', cell: () => 'acme' }]);
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.indexOf('租戶')).toBe(headers.indexOf('工作') + 1);
    expect(headers.indexOf('狀態')).toBe(headers.indexOf('租戶') + 1);
  });

  it('展開的列以 renderDetail 顯示明細', () => {
    renderTable(undefined, 'j1');
    expect(screen.getByTestId('detail')).toHaveTextContent('j1');
  });
});
