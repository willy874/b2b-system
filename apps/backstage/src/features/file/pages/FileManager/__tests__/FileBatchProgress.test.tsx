import {
  registerBatchOperation,
  resetBatchOperations,
  setActiveBatchQueue,
} from '@b2b-system/web-core/batch';
import type { BatchQueueClient } from '@b2b-system/web-core/batch';
import { AllProviders, createFakeBatchQueue } from '@b2b-system/web-core/testing';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { FILE_MANAGER_SCOPE } from '../../../batch';
import { FileBatchProgress } from '../components/FileBatchProgress';
import { useFileActions } from '../useFileActions';

let queue: ReturnType<typeof createFakeBatchQueue>;
let tab: BatchQueueClient;
const releases: Array<() => void> = [];

const items = (...ids: string[]) => ids.map((id) => ({ id, label: id }));

beforeAll(() => initTestI18n());

beforeEach(async () => {
  resetBatchOperations();
  // 每一筆回報幾次進度再等測試放行：佇列每次進度都廣播一份快照
  registerBatchOperation({
    id: 'op',
    labelKey: 'op.label',
    successKey: 'op.success',
    run: async (_id, { reportProgress }) => {
      reportProgress({ loaded: 1, total: 4 });
      reportProgress({ loaded: 3, total: 4 });
      await new Promise<void>((resolve) => releases.push(resolve));
    },
  });
  queue = createFakeBatchQueue();
  tab = queue.openTab('this-tab');
  await tab.start();
  setActiveBatchQueue(tab);
});

afterEach(() => {
  setActiveBatchQueue(undefined);
  queue.dispose();
  releases.length = 0;
});

/** 第 `index` 筆（從 0 起算，跨工作連續編號）開始處理後放行它 */
async function release(index: number): Promise<void> {
  await waitFor(() => expect(releases.length).toBeGreaterThan(index));
  releases[index]?.();
}

describe('檔案管理器的批次進度（docs/architecture/frontend/12-file-manager.md §14）', () => {
  it('useFileActions 不訂閱佇列：工作從開始到結束的每個快照都不讓頁面重繪', async () => {
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useFileActions();
      },
      { wrapper: AllProviders },
    );
    const before = renders;

    tab.enqueue({ operation: 'op', scope: FILE_MANAGER_SCOPE, items: items('1', '2', '3') });
    await release(0);
    await release(1);
    await release(2);
    await waitFor(() => expect(tab.getJobs()[0]?.status).toBe('done'));

    expect(renders).toBe(before);
  });

  it('FileBatchProgress：檔案管理器送出的工作進行中時顯示進度條，結束後消失', async () => {
    render(<FileBatchProgress />, { wrapper: AllProviders });
    // 其他列表送出的工作不在這裡顯示
    tab.enqueue({ operation: 'op', scope: 'user-list', items: items('u1') });
    await waitFor(() => expect(releases).toHaveLength(1));
    expect(screen.queryByTestId('batch-progress-bar')).not.toBeInTheDocument();
    await release(0);
    await waitFor(() => expect(tab.getJobs()[0]?.status).toBe('done'));

    tab.enqueue({ operation: 'op', scope: FILE_MANAGER_SCOPE, items: items('1', '2') });
    expect(await screen.findByTestId('batch-progress-bar')).toBeInTheDocument();
    await release(1);
    await release(2);

    await waitFor(() => expect(screen.queryByTestId('batch-progress-bar')).not.toBeInTheDocument());
  });
});
