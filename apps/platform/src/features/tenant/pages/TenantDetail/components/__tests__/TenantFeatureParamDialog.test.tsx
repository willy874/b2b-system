import { AppError } from '@b2b-system/web-core/errors';
import { renderInRouter } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TenantFeatureParam } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import tenantZhTW from '../../../../locales/zh_TW.json';
import { FEATURE_PARAMS, tenantFixture } from '../../../../test-fixtures';
import { TenantFeatureParamDialog } from '../TenantFeatureParamDialog';

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/apis/platform-tenant/update-tenant/fetcher', () => ({
  fetchUpdateTenantMutation: update,
}));

function paramOf(key: string, overrides: Partial<TenantFeatureParam> = {}): TenantFeatureParam {
  const param = FEATURE_PARAMS.find((item) => item.key === key);
  if (!param) throw new Error(`找不到參數 ${key}`);
  return { ...param, ...overrides };
}

const tenant = tenantFixture();

/** 以按鈕切換編輯中的參數（頁面上點不同列的「編輯」）。 */
function Harness({ params, onClose }: { params: TenantFeatureParam[]; onClose: () => void }) {
  const [editing, setEditing] = useState<TenantFeatureParam | undefined>(params[0]);
  return (
    <>
      {params.map((param) => (
        <button key={param.key} type="button" onClick={() => setEditing(param)}>
          {`edit ${param.key}`}
        </button>
      ))}
      <TenantFeatureParamDialog
        tenant={tenant}
        param={editing}
        onClose={() => {
          onClose();
          setEditing(undefined);
        }}
      />
    </>
  );
}

async function open(...params: TenantFeatureParam[]) {
  const onClose = vi.fn();
  renderInRouter(<Harness params={params} onClose={onClose} />, ['tenant:update']);
  const dialog = await screen.findByTestId('tenant-param-dialog');
  return { dialog, onClose, input: within(dialog).getByTestId('tenant-param-input') };
}

function submit() {
  fireEvent.click(screen.getByTestId('tenant-param-submit'));
}

beforeAll(() => initTestI18n(tenantZhTW));

beforeEach(() => {
  update.mockReset().mockResolvedValue(tenant);
});

describe('TenantFeatureParamDialog（docs/architecture/05-tenancy.md §13.2 D3）', () => {
  it('整數：帶入目前的值，範圍內的值以數字送出後關閉', async () => {
    const { input, onClose } = await open(paramOf('job.maxConcurrency'));
    expect(input).toHaveValue(10);
    expect(input).toHaveAttribute('type', 'number');
    fireEvent.change(input, { target: { value: '20' } });
    submit();
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { featureParams: { 'job.maxConcurrency': 20 } } },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it.each([
    ['空白', ''],
    ['小數', '1.5'],
    ['超過上限', '101'],
  ])('整數：%s → 提示允許的範圍、不送出', async (_label, value) => {
    const { input, dialog } = await open(paramOf('job.maxConcurrency'));
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest('form')!);
    expect(await within(dialog).findByTestId('field-error')).toHaveTextContent('1～100');
    expect(update).not.toHaveBeenCalled();
  });

  it('沒有上下限的整數不限範圍', async () => {
    const { input } = await open(paramOf('job.maxConcurrency', { min: null, max: null }));
    fireEvent.change(input, { target: { value: '100000' } });
    submit();
    await waitFor(() => expect(update).toHaveBeenCalled());
  });

  it('字串：原樣送出，不檢查範圍', async () => {
    const { input } = await open(paramOf('rateLimit.trustedCidrs'));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('maxLength', '1000');
    fireEvent.change(input, { target: { value: '10.0.0.0/8' } });
    submit();
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: {
        id: tenant.id,
        body: { featureParams: { 'rateLimit.trustedCidrs': '10.0.0.0/8' } },
      },
    });
  });

  it('沒有調整過 → 沒有「恢復預設」', async () => {
    await open(paramOf('job.maxConcurrency'));
    expect(screen.queryByTestId('tenant-param-reset')).toBeNull();
  });

  it('恢復預設送出中：恢復鈕 loading、儲存鈕停用', async () => {
    let finish: (value: unknown) => void = () => undefined;
    update.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { onClose } = await open(paramOf('job.maxConcurrency', { value: 3, overridden: true }));
    fireEvent.click(screen.getByTestId('tenant-param-reset'));
    await waitFor(() =>
      expect(screen.getByTestId('tenant-param-reset')).toHaveAttribute('aria-disabled', 'true'),
    );
    expect(screen.getByTestId('tenant-param-submit')).toBeDisabled();
    finish(tenant);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('儲存送出中：恢復鈕停用', async () => {
    let finish: (value: unknown) => void = () => undefined;
    update.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { input } = await open(paramOf('job.maxConcurrency', { value: 3, overridden: true }));
    fireEvent.change(input, { target: { value: '4' } });
    submit();
    await waitFor(() => expect(screen.getByTestId('tenant-param-reset')).toBeDisabled());
    finish(tenant);
  });

  it('後端拒絕（403）→ 錯誤顯示在欄位上，對話框留著', async () => {
    update.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const { input, dialog, onClose } = await open(paramOf('job.maxConcurrency'));
    fireEvent.change(input, { target: { value: '5' } });
    submit();
    expect(await within(dialog).findByTestId('field-error')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('打開另一個參數 → 以它的值重設表單並清掉錯誤', async () => {
    const { input, dialog } = await open(
      paramOf('job.maxConcurrency'),
      paramOf('webhook.maxUrls', { value: 7 }),
    );
    fireEvent.change(input, { target: { value: '0' } });
    submit();
    await within(dialog).findByTestId('field-error');

    fireEvent.click(screen.getByRole('button', { name: 'edit webhook.maxUrls', hidden: true }));
    await waitFor(() => expect(screen.getByTestId('tenant-param-input')).toHaveValue(7));
    expect(screen.queryByTestId('field-error')).toBeNull();
  });

  it('沒改就取消 → 直接關閉；改了再取消 → 先確認放棄', async () => {
    const { input, onClose } = await open(paramOf('job.maxConcurrency'));
    fireEvent.change(input, { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('tenant-param-cancel'));
    expect(await screen.findByTestId('alert-dialog-confirm')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('alert-dialog-confirm')).toBeNull());

    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('tenant-param-cancel'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
