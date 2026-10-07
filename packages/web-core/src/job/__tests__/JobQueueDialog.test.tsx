import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import { JobQueueDialog } from '../JobQueueDialog';
import { QUEUE } from './fixtures';

beforeAll(() => initTestI18n({}));

describe('JobQueueDialog（工作種類的卡片收在對話框裡）', () => {
  it('按鈕上掛著失敗總數；沒有失敗就不顯示', () => {
    const { rerender } = render(
      <JobQueueDialog
        queues={[QUEUE, { ...QUEUE, name: 'audit.archive', failedCount: 1 }]}
        selectedNames={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('job-queue-open-failed')).toHaveAttribute('data-value', '3');

    rerender(
      <JobQueueDialog
        queues={[{ ...QUEUE, failedCount: 0 }]}
        selectedNames={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('job-queue-open-failed')).not.toBeInTheDocument();
  });

  it('打開才渲染卡片；點卡片套用篩選，對話框維持開著', async () => {
    const onSelect = vi.fn();
    render(<JobQueueDialog queues={[QUEUE]} selectedNames={[]} onSelect={onSelect} />);
    expect(screen.queryByTestId('job-queue-card')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('job-queue-open'));
    const dialog = await screen.findByTestId('job-queue-dialog');
    fireEvent.click(within(dialog).getByTestId('job-queue-card'));
    expect(onSelect).toHaveBeenCalledWith(['file.maintenance']);
    expect(screen.getByTestId('job-queue-dialog')).toBeInTheDocument();
  });

  it('查詢失敗而且沒有資料：對話框裡顯示錯誤與重試', async () => {
    const onRetry = vi.fn();
    render(
      <JobQueueDialog
        queues={[]}
        error={new AppError('INTERNAL_ERROR', 500)}
        onRetry={onRetry}
        selectedNames={[]}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('job-queue-open'));
    expect(await screen.findByTestId('job-queue-error')).toBeInTheDocument();
  });
});
