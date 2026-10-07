import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { initTestI18n } from '../../testing/i18n';
import { JobQueueSummary } from '../JobQueueSummary';
import { QUEUE } from './fixtures';

beforeAll(() => initTestI18n({ job: { scope: { tenant: '每個租戶' } } }));

describe('JobQueueSummary（每種工作一張卡片）', () => {
  it('顯示排程、各狀態的筆數與失敗數（testid ＋ data-value）', () => {
    render(<JobQueueSummary queues={[QUEUE]} />);
    const card = screen.getByTestId('job-queue-card');
    expect(card).toHaveAttribute('data-value', 'file.maintenance');
    expect(card).toHaveTextContent('排程：0 3 * * *（UTC）');
    expect(within(card).getByTestId('job-queue-failed')).toHaveAttribute('data-value', '2');
  });

  it('沒有失敗就不顯示失敗數；沒有範圍就不顯示「範圍 ·」', () => {
    render(<JobQueueSummary queues={[{ ...QUEUE, failedCount: 0, cron: null }]} />);
    expect(screen.queryByTestId('job-queue-failed')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-queue-card')).not.toHaveTextContent('·');
    expect(screen.getByTestId('job-queue-card')).toHaveTextContent('由程式入列');
  });

  it('有範圍時放在排程前面（apps/platform）', () => {
    render(<JobQueueSummary queues={[{ ...QUEUE, scopeLabelKey: 'job.scope.tenant' }]} />);
    expect(screen.getByTestId('job-queue-card')).toHaveTextContent('每個租戶 · 排程');
  });

  it('卡片只顯示資訊，不是可以按的按鈕', () => {
    render(<JobQueueSummary queues={[QUEUE]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-queue-card')).not.toHaveAttribute('aria-pressed');
  });
});
