import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import { renderWithPermissions } from '../../testing/renderWithPermissions';
import { JobRowActions } from '../JobRowActions';
import { ROW } from './fixtures';

beforeAll(() => initTestI18n());

describe('JobRowActions（列上的操作）', () => {
  it('canRetry → 顯示重試與展開', () => {
    renderWithPermissions(
      <JobRowActions row={ROW} isExpanded={false} onToggleExpand={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByTestId('job-retry')).toHaveAttribute('data-value', 'j1');
    expect(screen.getByTestId('job-expand')).toBeEnabled();
  });

  it('沒有重試權限、不是 failed 或權限未水合（adapter 給 canRetry = false）→ 只有展開', () => {
    renderWithPermissions(
      <JobRowActions
        row={{ ...ROW, canRetry: false }}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('job-retry')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-expand')).toBeInTheDocument();
  });

  it('點重試先開確認框，確認後才以這一列的 id 重試', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    renderWithPermissions(
      <JobRowActions row={ROW} isExpanded={false} onToggleExpand={vi.fn()} onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByTestId('job-retry'));
    const dialog = await screen.findByRole('alertdialog');
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith('j1'));
  });

  it('重試失敗：提示錯誤，確認框留著讓使用者決定', async () => {
    const onRetry = vi.fn().mockRejectedValue(new AppError('JOB_NOT_RETRYABLE', 409));
    renderWithPermissions(
      <JobRowActions row={ROW} isExpanded={false} onToggleExpand={vi.fn()} onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByTestId('job-retry'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(onRetry).toHaveBeenCalled());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('點展開回報這一列的 id；展開時按鈕標示 aria-expanded', () => {
    const onToggleExpand = vi.fn();
    renderWithPermissions(
      <JobRowActions row={ROW} isExpanded onToggleExpand={onToggleExpand} onRetry={vi.fn()} />,
    );
    const expand = screen.getByTestId('job-expand');
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(expand);
    expect(onToggleExpand).toHaveBeenCalledWith('j1');
  });
});
