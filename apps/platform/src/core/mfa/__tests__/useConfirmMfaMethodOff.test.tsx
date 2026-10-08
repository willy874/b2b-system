import { AppError } from '@b2b-system/web-core/errors';
import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { useConfirmMfaMethodOff } from '../useConfirmMfaMethodOff';

type Input = Parameters<ReturnType<typeof useConfirmMfaMethodOff>>[0];

/** 以按鈕觸發 hook 回傳的函式，結果交給 `onResult`。 */
function Harness({ input, onResult }: { input: Input; onResult: (value: boolean) => void }) {
  const confirmOff = useConfirmMfaMethodOff();
  return (
    <button type="button" onClick={() => void confirmOff(input).then(onResult)}>
      off
    </button>
  );
}

function run(input: Partial<Input> = {}) {
  const onResult = vi.fn();
  const apply = input.apply ?? vi.fn().mockResolvedValue(undefined);
  const loadImpact = input.loadImpact ?? vi.fn().mockResolvedValue({ stranded: 0 });
  renderWithPermissions(
    <Harness input={{ label: '簡訊', loadImpact, apply }} onResult={onResult} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'off' }));
  return { onResult, apply, loadImpact };
}

beforeAll(() => initTestI18n());

describe('useConfirmMfaMethodOff（docs/architecture/backend/21-mfa.md §5）', () => {
  it('有人會被擋在門外：確認框寫出人數，確認後才套用並回 true', async () => {
    const { onResult, apply } = run({ loadImpact: vi.fn().mockResolvedValue({ stranded: 3 }) });

    const dialog = await screen.findByTestId('mfa-method-off-dialog');
    expect(dialog).toHaveTextContent('關閉「簡訊」？');
    expect(dialog).toHaveTextContent('3 位使用者只有這種驗證方式');
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(apply).toHaveBeenCalledOnce();
  });

  it('沒有人受影響：顯示無影響的說明', async () => {
    run();
    expect(await screen.findByTestId('mfa-method-off-dialog')).toHaveTextContent(
      '沒有使用者會因此無法登入',
    );
  });

  it('取消 → 不套用，回 false', async () => {
    const { onResult, apply } = run();
    await screen.findByTestId('mfa-method-off-dialog');
    fireEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(apply).not.toHaveBeenCalled();
  });

  it('查不到影響人數 → 提示錯誤、不開確認框，回 false', async () => {
    const { onResult, apply } = run({
      loadImpact: vi.fn().mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403)),
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-method-off-dialog')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('套用失敗（例：403）→ 提示錯誤，確認框留著讓使用者重試或取消', async () => {
    const apply = vi
      .fn()
      .mockRejectedValueOnce(new AppError('AUTHZ_FORBIDDEN', 403))
      .mockResolvedValueOnce(undefined);
    const { onResult } = run({ apply });
    await screen.findByTestId('mfa-method-off-dialog');

    fireEvent.click(screen.getByTestId('alert-dialog-confirm'));
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-method-off-dialog')).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
