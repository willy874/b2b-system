import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderUnhydrated, renderWithPermissions } from '@/test/renderWithPermissions';

import type { JobRowVM } from '../adapter';
import { JobRowActions } from '../components/JobRowActions';

const ROW: JobRowVM = {
  id: 'j1',
  name: 'file.maintenance',
  labelKey: 'job.name.fileMaintenance',
  owner: { kind: 'tenant', label: 'acme' },
  ownerValue: 'acme',
  state: 'failed',
  stateLabelKey: 'job.state.failed',
  stateTone: 'danger',
  retryCount: 2,
  retryLimit: 2,
  createdAt: new Date('2026-09-29T10:00:00.000Z'),
  scheduledAt: null,
  completedAt: new Date('2026-09-29T10:00:02.000Z'),
  canRetry: true,
};

describe('JobRowActions（列上的操作）', () => {
  it('可以重試 → 顯示重試與展開', () => {
    renderWithPermissions(<JobRowActions row={ROW} isExpanded={false} onToggleExpand={vi.fn()} />);
    expect(screen.getByTestId('job-retry')).toBeEnabled();
    expect(screen.getByTestId('job-expand')).toBeEnabled();
  });

  it('沒有 platformJob:retry 或不是 failed（canRetry = false）→ 只有展開', () => {
    renderWithPermissions(
      <JobRowActions
        row={{ ...ROW, canRetry: false }}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('job-retry')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-expand')).toBeInTheDocument();
  });

  it('權限未水合時 adapter 不給 canRetry → 不閃現', () => {
    renderUnhydrated(
      <JobRowActions
        row={{ ...ROW, canRetry: false }}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('job-retry')).not.toBeInTheDocument();
  });

  it('點重試先開確認框，不會直接送出', async () => {
    renderWithPermissions(<JobRowActions row={ROW} isExpanded={false} onToggleExpand={vi.fn()} />);
    fireEvent.click(screen.getByTestId('job-retry'));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('點展開回報這一列的 id', () => {
    const onToggleExpand = vi.fn();
    renderWithPermissions(
      <JobRowActions row={ROW} isExpanded={false} onToggleExpand={onToggleExpand} />,
    );
    fireEvent.click(screen.getByTestId('job-expand'));
    expect(onToggleExpand).toHaveBeenCalledWith('j1');
  });
});
