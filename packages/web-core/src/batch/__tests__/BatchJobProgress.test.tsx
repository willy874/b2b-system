import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { initTestI18n } from '../../testing/i18n';
import { BatchJobProgress } from '../BatchJobProgress';
import type { BatchJob } from '../types';

const job = (overrides: Partial<BatchJob> = {}): BatchJob => ({
  id: 'job-1',
  operation: 'op',
  scope: 'list',
  ownerId: 'tab',
  items: [
    { id: '1', label: '1' },
    { id: '2', label: '2' },
  ],
  status: 'running',
  succeeded: ['1'],
  failures: [],
  concurrency: 1,
  progress: {},
  createdAt: 0,
  ...overrides,
});

beforeAll(() => initTestI18n());

describe('BatchJobProgress（一個批次工作的進度）', () => {
  it('被限流而暫停時說明原因（docs/architecture/frontend/07-ui-system.md §13.4）', () => {
    render(<BatchJobProgress job={job({ pausedUntil: Date.now() + 5000 })} />);
    expect(screen.getByTestId('batch-progress-paused')).toHaveTextContent('已達請求上限');
  });

  it('沒有暫停時不顯示', () => {
    render(<BatchJobProgress job={job()} />);
    expect(screen.queryByTestId('batch-progress-paused')).not.toBeInTheDocument();
  });
});
