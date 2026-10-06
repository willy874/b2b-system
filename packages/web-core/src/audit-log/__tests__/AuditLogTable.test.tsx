import { fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '../../testing/i18n';
import { renderWithPermissions } from '../../testing/renderWithPermissions';
import { AuditLogTable } from '../AuditLogTable';
import type { AuditLogRowVM } from '../types';

const ROW: AuditLogRowVM = {
  id: 'log-1',
  occurredAt: new Date('2026-09-19T02:10:00.000Z'),
  actorEmail: 'admin@example.com',
  action: 'role.update',
  isHighRisk: false,
  resourceLabel: 'role · 內容編輯',
  result: 'success',
  isSuccess: true,
  errorCode: null,
};

const PAGINATION = { offset: 0, limit: 50, total: 1, onChange: vi.fn() };
const FILTERS = { fields: [], value: {}, onSubmit: vi.fn() };

function renderTable(items: AuditLogRowVM[], expandedId?: string, onToggleExpand = vi.fn()) {
  renderWithPermissions(
    <AuditLogTable
      items={items}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      expandedId={expandedId}
      onToggleExpand={onToggleExpand}
      filters={FILTERS}
      pagination={PAGINATION}
      settings={{ tableId: 'audit-log-test' }}
      renderDetail={(row) => <p data-testid="detail">{row.id}</p>}
    />,
  );
}

beforeAll(() => initTestI18n());

describe('AuditLogTable（稽核紀錄的列表）', () => {
  it('動作與結果帶 testid ＋ data-value；資源欄顯示 resourceLabel', () => {
    renderTable([ROW]);
    const table = screen.getByTestId('audit-log-table');
    expect(within(table).getByTestId('audit-log-action')).toHaveAttribute(
      'data-value',
      'role.update',
    );
    expect(within(table).getByTestId('audit-log-result')).toHaveAttribute('data-value', 'success');
    expect(within(table).getByTestId('audit-log-result')).toHaveTextContent('成功');
    expect(table).toHaveTextContent('role · 內容編輯');
  });

  it('失敗顯示錯誤碼；高風險的動作另外標示', () => {
    renderTable([
      {
        ...ROW,
        action: 'auth.refresh.reuse_detected',
        isHighRisk: true,
        result: 'failure',
        isSuccess: false,
        errorCode: 'AUTH_REFRESH_REUSED',
      },
    ]);
    expect(screen.getByTestId('audit-log-result')).toHaveTextContent('AUTH_REFRESH_REUSED');
    expect(screen.getByTestId('audit-log-table')).toHaveTextContent('高風險');
  });

  it('點展開回報這一列的 id；展開的列以 renderDetail 顯示明細', () => {
    const onToggleExpand = vi.fn();
    renderTable([ROW], 'log-1', onToggleExpand);
    expect(screen.getByTestId('detail')).toHaveTextContent('log-1');
    const expand = screen.getByTestId('audit-log-expand');
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(expand);
    expect(onToggleExpand).toHaveBeenCalledWith('log-1');
  });
});
