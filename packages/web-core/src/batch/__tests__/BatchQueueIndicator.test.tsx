import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeBatchQueue } from '../../testing/fakeBatchQueue';
import { AllProviders } from '../../testing/renderWithPermissions';
import { setActiveBatchQueue } from '../activeQueue';
import type { BatchQueueClient } from '../BatchQueueClient';
import { BatchQueueIndicator } from '../BatchQueueIndicator';
import { registerBatchOperation, resetBatchOperations } from '../operations';

let queue: ReturnType<typeof createFakeBatchQueue>;
let tab: BatchQueueClient;
let release: () => void;

beforeEach(async () => {
  resetBatchOperations();
  registerBatchOperation({
    id: 'op',
    labelKey: 'op.label',
    successKey: 'op.success',
    run: () =>
      new Promise((resolve) => {
        release = () => resolve(undefined);
      }),
  });
  queue = createFakeBatchQueue();
  tab = queue.openTab('this-tab');
  await tab.start();
  setActiveBatchQueue(tab);
});

afterEach(() => {
  setActiveBatchQueue(undefined);
  queue.dispose();
});

const items = (...ids: string[]) => ids.map((id) => ({ id, label: id }));

describe('BatchQueueIndicator（AppHeader 的佇列按鈕）', () => {
  it('徽章顯示進行中的工作數，點開列出每個工作的進度', async () => {
    render(<BatchQueueIndicator />, { wrapper: AllProviders });
    expect(screen.queryByTestId('batch-queue-count')).not.toBeInTheDocument();

    tab.enqueue({ operation: 'op', scope: 'a', items: items('1', '2') });
    tab.enqueue({ operation: 'op', scope: 'b', items: items('3') });
    expect(await screen.findByTestId('batch-queue-count')).toHaveTextContent('2');

    await userEvent.click(screen.getByTestId('batch-queue-trigger'));
    const panel = await screen.findByTestId('batch-queue-panel');
    const statuses = within(panel)
      .getAllByTestId('batch-progress')
      .map((item) => item.getAttribute('data-status'));
    // 新的在上面：第二個工作排在第一個後面
    expect(statuses).toEqual(['queued', 'running']);
  });

  it('可以從面板取消進行中的工作；結束後可清除', async () => {
    render(<BatchQueueIndicator />, { wrapper: AllProviders });
    tab.enqueue({ operation: 'op', scope: 'a', items: items('1', '2') });
    await userEvent.click(await screen.findByTestId('batch-queue-trigger'));
    const panel = await screen.findByTestId('batch-queue-panel');

    await userEvent.click(await within(panel).findByTestId('batch-progress-cancel'));
    release();
    await waitFor(() =>
      expect(within(panel).getByTestId('batch-progress')).toHaveAttribute(
        'data-status',
        'cancelled',
      ),
    );
    expect(screen.queryByTestId('batch-queue-count')).not.toBeInTheDocument();

    await userEvent.click(within(panel).getByTestId('batch-queue-clear'));
    await waitFor(() =>
      expect(within(panel).queryByTestId('batch-progress')).not.toBeInTheDocument(),
    );
  });

  it('佇列沒有啟用 → 不顯示按鈕', () => {
    setActiveBatchQueue(undefined);
    render(<BatchQueueIndicator />, { wrapper: AllProviders });
    expect(screen.queryByTestId('batch-queue-trigger')).not.toBeInTheDocument();
  });
});
