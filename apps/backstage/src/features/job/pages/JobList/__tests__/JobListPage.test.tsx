import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { JOB_FEATURE, registerJobPagePermissions, Routes } from '../../..';
import jobZhTW from '../../../locales/zh_TW.json';

const { fetchList, fetchQueues } = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchQueues: vi.fn(),
}));
vi.mock('@/apis/job/get-job-list/fetcher', () => ({ fetchJobListQuery: fetchList }));
vi.mock('@/apis/job/get-job-queue-list/fetcher', () => ({ fetchJobQueueListQuery: fetchQueues }));

const EMPTY_LIST = { items: [], pagination: { offset: 0, limit: 25, total: 0 } };
const routes = [Routes.JobListRoute];

beforeAll(() => initTestI18n(jobZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerJobPagePermissions();
  featureStore.setState({ resolved: true, statuses: new Map([[JOB_FEATURE, 'ready']]) });
  fetchList.mockReset().mockResolvedValue(EMPTY_LIST);
  fetchQueues.mockReset().mockResolvedValue({ items: [] });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('JobListPage（docs/architecture/frontend/07-ui-system.md §6.1）', () => {
  it('列表查詢失敗 → 顯示錯誤與重試，不落到「沒有資料」', async () => {
    fetchList.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/job', ['job:read'] as PermissionKey[]);

    const error = await screen.findByTestId('rich-table-error', undefined, { timeout: 5000 });
    expect(screen.queryByText('沒有資料')).toBeNull();

    fetchList.mockResolvedValue(EMPTY_LIST);
    fireEvent.click(within(error).getByTestId('query-error-retry'));
    expect(await screen.findByText('沒有資料')).toBeInTheDocument();
  });

  it('佇列摘要查詢失敗 → 對話框裡顯示錯誤與重試，卡片不是默默消失', async () => {
    fetchQueues.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/job', ['job:read'] as PermissionKey[]);

    fireEvent.click(await screen.findByTestId('job-queue-open'));
    const error = await screen.findByTestId('job-queue-error', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('job-queue-summary')).toBeNull();

    fetchQueues.mockResolvedValue({ items: [] });
    fireEvent.click(within(error).getByTestId('query-error-retry'));
    expect(await screen.findByTestId('job-queue-summary')).toBeInTheDocument();
  });
});
