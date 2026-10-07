import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import { JobPageTabs } from '../JobPageTabs';
import type { JobPageTabsProps } from '../JobPageTabs';
import { QUEUE } from './fixtures';

beforeAll(() => initTestI18n({}));

function renderTabs(props: Partial<JobPageTabsProps> = {}) {
  return render(
    <JobPageTabs view="list" onViewChange={vi.fn()} queues={[QUEUE]} {...props}>
      <div data-testid="job-list-content" />
    </JobPageTabs>,
  );
}

describe('JobPageTabs（工作列表、佇列概況兩個分頁）', () => {
  it('view=list → 只渲染列表；卡片收在另一個分頁', () => {
    renderTabs();
    expect(screen.getByTestId('job-list-content')).toBeInTheDocument();
    expect(screen.queryByTestId('job-queue-card')).not.toBeInTheDocument();
  });

  it('view=queues → 渲染卡片，不渲染列表', () => {
    renderTabs({ view: 'queues' });
    expect(screen.getByTestId('job-queue-card')).toHaveAttribute('data-value', 'file.maintenance');
    expect(screen.queryByTestId('job-list-content')).not.toBeInTheDocument();
  });

  it('點分頁 → onViewChange', () => {
    const onViewChange = vi.fn();
    renderTabs({ onViewChange });
    const tab = document.querySelector<HTMLElement>(
      '[data-testid="job-view-tab"][data-value="queues"]',
    );
    if (!tab) throw new Error('找不到「佇列概況」分頁');
    fireEvent.click(tab);
    expect(onViewChange).toHaveBeenCalledWith('queues');
  });

  it('「佇列概況」分頁上掛著失敗總數；沒有失敗就不顯示', () => {
    const { rerender } = renderTabs({
      queues: [QUEUE, { ...QUEUE, name: 'audit.archive', failedCount: 1 }],
    });
    expect(screen.getByTestId('job-queue-tab-failed')).toHaveAttribute('data-value', '3');

    rerender(
      <JobPageTabs view="list" onViewChange={vi.fn()} queues={[{ ...QUEUE, failedCount: 0 }]}>
        <div />
      </JobPageTabs>,
    );
    expect(screen.queryByTestId('job-queue-tab-failed')).not.toBeInTheDocument();
  });

  it('佇列查詢失敗而且沒有資料：分頁裡顯示錯誤與重試', () => {
    const onRetryQueues = vi.fn();
    renderTabs({
      view: 'queues',
      queues: [],
      queueError: new AppError('INTERNAL_ERROR', 500),
      onRetryQueues,
    });
    expect(screen.getByTestId('job-queue-error')).toBeInTheDocument();
    expect(screen.queryByTestId('job-queue-summary')).not.toBeInTheDocument();
  });
});
