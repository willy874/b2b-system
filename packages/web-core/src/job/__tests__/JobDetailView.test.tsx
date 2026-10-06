import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import { AllProviders } from '../../testing/renderWithPermissions';
import { JobDetailView } from '../JobDetailView';
import type { JobDetailJsonOptions } from '../JobDetailView';

beforeAll(() => initTestI18n());

const renderJson = vi.fn((value: Record<string, unknown>, { testId }: JobDetailJsonOptions) => (
  <pre data-testid={testId}>{JSON.stringify(value)}</pre>
));

function renderView(props: Partial<Parameters<typeof JobDetailView>[0]>) {
  render(
    <AllProviders>
      <JobDetailView
        data={undefined}
        error={null}
        isPending={false}
        renderJson={renderJson}
        {...props}
      />
    </AllProviders>,
  );
}

describe('JobDetailView（展開列的明細）', () => {
  it('載入中：顯示載入中並標示 aria-busy', () => {
    renderView({ isPending: true });
    expect(screen.getByTestId('job-detail')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('job-detail')).toHaveTextContent('載入中');
  });

  it('查詢失敗：以 alert 顯示本地化的錯誤', () => {
    renderView({ error: new AppError('JOB_NOT_FOUND', 404) });
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement();
  });

  it('失敗的工作：顯示失敗原因、工作資料與結果（JSON 交給 renderJson）', () => {
    renderView({ data: { errorMessage: 'boom', data: { a: 1 }, output: { message: 'boom' } } });
    expect(screen.getByTestId('job-detail-error')).toHaveTextContent('boom');
    expect(screen.getByTestId('job-detail-data')).toHaveTextContent('{"a":1}');
    expect(screen.getByTestId('job-detail-output')).toBeInTheDocument();
    expect(renderJson).toHaveBeenCalledWith(
      { a: 1 },
      { testId: 'job-detail-data', label: '工作資料' },
    );
  });

  it('還沒有結果：顯示「尚無結果」', () => {
    renderView({ data: { errorMessage: null, data: {}, output: null } });
    expect(screen.queryByTestId('job-detail-output')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-detail')).toHaveTextContent('尚無結果');
  });
});
