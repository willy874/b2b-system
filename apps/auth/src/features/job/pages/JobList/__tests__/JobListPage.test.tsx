import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerJobPagePermissions, Routes } from '../../..';
import jobZhTW from '../../../locales/zh_TW.json';
import { jobFixture, jobQueueFixture } from '../../../test-fixtures';

const { listQueues, listJobs, getJob, retryJob, invalidateResources } = vi.hoisted(() => ({
  listQueues: vi.fn(),
  listJobs: vi.fn(),
  getJob: vi.fn(),
  retryJob: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/platform-job/get-job-queues/query', () => ({
  PLATFORM_JOB_QUEUES_QUERY_KEY: 'PLATFORM_JOB_QUEUES_QUERY_KEY',
  getPlatformJobQueuesQueryOptions: () => ({
    queryKey: ['PLATFORM_JOB_QUEUES_QUERY_KEY'],
    queryFn: listQueues,
  }),
}));
vi.mock('@/apis/platform-job/get-job-list/query', () => ({
  PLATFORM_JOB_LIST_QUERY_KEY: 'PLATFORM_JOB_LIST_QUERY_KEY',
  getPlatformJobListQueryOptions: ({ params }: { params: Record<string, unknown> }) => ({
    queryKey: ['PLATFORM_JOB_LIST_QUERY_KEY', params],
    queryFn: () => listJobs(params),
  }),
}));
vi.mock('@/apis/platform-job/get-job/query', () => ({
  PLATFORM_JOB_DETAIL_QUERY_KEY: 'PLATFORM_JOB_DETAIL_QUERY_KEY',
  getPlatformJobQueryOptions: (id: string) => ({
    queryKey: ['PLATFORM_JOB_DETAIL_QUERY_KEY', id],
    queryFn: () => getJob(id),
  }),
}));
vi.mock('@/apis/platform-job/retry-job/mutation', () => ({
  getRetryPlatformJobMutationOptions: () => ({ mutationFn: retryJob }),
}));
vi.mock('@/apis/resources', () => ({
  Resource: { PLATFORM_JOB: 'platformJob' },
  invalidateResources,
}));

const TENANT_JOB = jobFixture();
const PLATFORM_JOB = jobFixture({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'tenant.provision',
  state: 'completed',
  tenantId: null,
  tenantCode: null,
});
const ORPHAN_JOB = jobFixture({
  id: '33333333-3333-4333-8333-333333333333',
  state: 'failed',
  tenantId: '55555555-5555-4555-8555-555555555555',
  tenantCode: null,
});

function renderPage(permissions: PermissionKey[] | 'unhydrated', initialPath = '/job') {
  return renderRoute([Routes.JobListRoute], initialPath, permissions).router;
}

async function openFilters(): Promise<HTMLElement> {
  await userEvent.click(within(screen.getByTestId('job-table')).getByTestId('filter-bar-trigger'));
  return screen.findByTestId('filter-bar-popup');
}

async function chooseScope(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: '範圍' }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

beforeAll(() => initTestI18n(jobZhTW));

const lastListParams = () => listJobs.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  resetPagePermissionRegistry();
  registerJobPagePermissions();
  listQueues.mockReset().mockResolvedValue({
    items: [
      jobQueueFixture(),
      jobQueueFixture({ name: 'tenant.provision', cron: null, scope: 'platform', failedCount: 0 }),
    ],
  });
  listJobs.mockReset().mockResolvedValue({
    items: [TENANT_JOB, PLATFORM_JOB, ORPHAN_JOB],
    pagination: { offset: 0, limit: 50, total: 3 },
  });
  getJob.mockReset();
  retryJob.mockReset();
  invalidateResources.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('平台的背景工作監控', () => {
  it('顯示每種工作的佇列卡片', async () => {
    renderPage(['platformJob:read']);
    await waitFor(() => expect(screen.getAllByTestId('job-queue-card')).toHaveLength(2));
    expect(
      screen.getAllByTestId('job-queue-card').map((card) => card.getAttribute('data-value')),
    ).toEqual(['file.maintenance', 'tenant.provision']);
    // 只有有失敗的佇列才顯示失敗數
    expect(screen.getByTestId('job-queue-failed')).toHaveAttribute('data-value', '1');
  });

  it('租戶欄：平台層級顯示 platform；租戶顯示代碼；租戶已刪除退回 id', async () => {
    renderPage(['platformJob:read']);
    await waitFor(() => expect(screen.getAllByTestId('job-tenant')).toHaveLength(3));
    expect(
      screen.getAllByTestId('job-tenant').map((cell) => cell.getAttribute('data-value')),
    ).toEqual(['acme', 'platform', ORPHAN_JOB.tenantId]);
  });

  it('預設不帶租戶條件（全部）', async () => {
    renderPage(['platformJob:read']);
    await waitFor(() => expect(listJobs).toHaveBeenCalled());
    expect(lastListParams()).toEqual({
      offset: 0,
      limit: 50,
      name: undefined,
      state: undefined,
      tenant: undefined,
    });
  });

  it('篩選「只看平台」→ 以 tenant=platform 查詢並寫進網址；改回「全部」取消', async () => {
    const router = renderPage(['platformJob:read']);
    await screen.findAllByTestId('job-tenant');

    await openFilters();
    await chooseScope('只看平台');
    await userEvent.click(screen.getByTestId('filter-bar-submit'));
    await waitFor(() => expect(lastListParams()).toMatchObject({ tenant: 'platform', offset: 0 }));
    expect(router.state.location.search).toMatchObject({ tenant: 'platform' });

    await openFilters();
    await chooseScope('全部租戶與平台');
    await userEvent.click(screen.getByTestId('filter-bar-submit'));
    await waitFor(() => expect(lastListParams()).toMatchObject({ tenant: undefined }));
  });

  it('輸入租戶代碼並送出 → 以該代碼查詢（去空白、轉小寫）', async () => {
    renderPage(['platformJob:read']);
    await screen.findAllByTestId('job-tenant');
    await openFilters();
    await userEvent.type(screen.getByRole('textbox', { name: '租戶代碼' }), ' Acme {Enter}');
    await waitFor(() => expect(lastListParams()).toMatchObject({ tenant: 'acme' }));
  });

  it('網址帶 tenant=platform → 直接以它查詢，面板的範圍是「只看平台」、租戶代碼留空', async () => {
    renderPage(['platformJob:read'], '/job?tenant=platform');
    await waitFor(() => expect(lastListParams()).toMatchObject({ tenant: 'platform' }));
    await openFilters();
    expect(screen.getByRole('combobox', { name: '範圍' })).toHaveTextContent('只看平台');
    expect(screen.getByRole('textbox', { name: '租戶代碼' })).toHaveValue('');
  });

  it('點佇列卡片 → 以該工作種類篩選；再點一次取消', async () => {
    renderPage(['platformJob:read']);
    const [card] = await screen.findAllByTestId('job-queue-card');
    fireEvent.click(card!);
    await waitFor(() => expect(lastListParams()).toMatchObject({ name: 'file.maintenance' }));
    expect(card).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(card!);
    await waitFor(() => expect(lastListParams()).toMatchObject({ name: undefined }));
  });

  it('有 platformJob:retry → 只有 failed 的工作有重試按鈕', async () => {
    renderPage(['platformJob:read', 'platformJob:retry']);
    await waitFor(() => expect(screen.getAllByTestId('job-retry')).toHaveLength(2));
    expect(
      screen.getAllByTestId('job-retry').map((button) => button.getAttribute('data-value')),
    ).toEqual([TENANT_JOB.id, ORPHAN_JOB.id]);
  });

  it('只有 platformJob:read → 沒有重試按鈕，仍可展開', async () => {
    renderPage(['platformJob:read']);
    await waitFor(() => expect(screen.getAllByTestId('job-expand')).toHaveLength(3));
    expect(screen.queryByTestId('job-retry')).toBeNull();
  });

  it('權限未水合 → 不閃現重試按鈕', async () => {
    renderPage('unhydrated');
    expect(await screen.findByTestId('job-page')).toBeInTheDocument();
    await waitFor(() => expect(listJobs).toHaveBeenCalled());
    expect(screen.queryByTestId('job-retry')).toBeNull();
  });

  it('重試：確認後送出並失效背景工作資源', async () => {
    retryJob.mockResolvedValue({ ...TENANT_JOB, state: 'created', data: {}, output: null });
    renderPage(['platformJob:read', 'platformJob:retry']);
    const [retryButton] = await screen.findAllByTestId('job-retry');
    fireEvent.click(retryButton!);
    expect(retryJob).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(retryJob).toHaveBeenCalled());
    expect(retryJob.mock.calls[0]?.[0]).toEqual({ params: { id: TENANT_JOB.id } });
    await waitFor(() =>
      expect(invalidateResources).toHaveBeenCalledWith([
        { resource: 'platformJob', kind: 'update', id: TENANT_JOB.id },
      ]),
    );
  });

  it('展開 → 取明細並顯示資料與失敗原因', async () => {
    getJob.mockResolvedValue({
      ...TENANT_JOB,
      data: { tenantId: TENANT_JOB.tenantId },
      output: { message: 'boom' },
    });
    renderPage(['platformJob:read']);
    const [expand] = await screen.findAllByTestId('job-expand');
    fireEvent.click(expand!);
    expect(await screen.findByTestId('job-detail-error')).toBeInTheDocument();
    expect(getJob).toHaveBeenCalledWith(TENANT_JOB.id);
    expect(screen.getByTestId('job-detail-data')).toBeInTheDocument();
  });
});
