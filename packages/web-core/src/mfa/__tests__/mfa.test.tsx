import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import { AllProviders } from '../../testing/renderWithPermissions';
import { CodeInput } from '../components/CodeInput';
import { FactorList } from '../components/FactorList';
import { MfaChallengeForm } from '../components/MfaChallengeForm';
import { RecoveryCodesDialog } from '../components/RecoveryCodesDialog';
import { totpMethod } from '../methods/totp';
import { mfaMethodRegistry, registerMfaMethod, requireMfaMethod } from '../registry';
import type { MfaChallengeProps, MfaMethodUi } from '../registry';
import type { MfaChallengeInfo, MfaFactorView } from '../types';

const factor = (method: string, overrides: Partial<MfaFactorView> = {}): MfaFactorView => ({
  id: `${method}-1`,
  method,
  label: null,
  hint: null,
  available: true,
  createdAt: '2026-10-07T00:00:00.000Z',
  lastUsedAt: null,
  ...overrides,
});

beforeAll(() => initTestI18n());

beforeEach(() => {
  mfaMethodRegistry.reset();
  registerMfaMethod(totpMethod);
});

afterEach(() => vi.restoreAllMocks());

describe('MFA 方式的註冊表（docs/architecture/backend/21-mfa.md §11）', () => {
  it('重複登記丟例外；程式內寫死的 id 沒登記也丟例外', () => {
    expect(() => registerMfaMethod(totpMethod)).toThrow('already registered');
    expect(requireMfaMethod('totp').id).toBe('totp');
    expect(() => requireMfaMethod('webauthn')).toThrow('not registered');
  });
});

describe('CodeInput', () => {
  it('只留數字、最多 6 位（貼上「123 456」也接受）', () => {
    const onChange = vi.fn();
    render(<CodeInput value="" onChange={onChange} data-testid="code" />);
    fireEvent.change(screen.getByTestId('code'), { target: { value: '12 34-56789' } });
    expect(onChange).toHaveBeenCalledWith('123456');
  });
});

describe('FactorList', () => {
  it('伺服器回傳沒有登記的方式：顯示「這個版本不支援」，畫面不壞；方式被關掉時註明', () => {
    render(
      <AllProviders>
        <FactorList
          factors={[factor('webauthn'), factor('totp', { available: false, label: 'iPhone' })]}
        />
      </AllProviders>,
    );
    expect(screen.getByText('這個版本不支援')).toBeInTheDocument();
    expect(screen.getByText('目前無法使用')).toBeInTheDocument();
    expect(screen.getByText('iPhone')).toBeInTheDocument();
  });
});

describe('RecoveryCodesDialog', () => {
  it('要勾「我已保存」才能按完成', () => {
    const onDone = vi.fn();
    render(
      <AllProviders>
        <RecoveryCodesDialog
          open
          codes={['AAAAA-BBBBB', 'CCCCC-DDDDD']}
          account="me@acme.test"
          onDone={onDone}
        />
      </AllProviders>,
    );
    expect(screen.getAllByTestId('mfa-recovery-code')).toHaveLength(2);
    const done = screen.getByTestId('mfa-recovery-done');
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalled();
  });
});

describe('MfaChallengeForm（登入的第二步）', () => {
  it('只有不支援的方式：直接顯示備用碼；送出 factorId = recovery', async () => {
    const verify = vi.fn(async () => undefined);
    render(
      <AllProviders>
        <MfaChallengeForm
          factors={[factor('webauthn')]}
          recoveryAvailable
          requestChallenge={vi.fn()}
          verify={verify}
        />
      </AllProviders>,
    );
    fireEvent.change(screen.getByTestId('mfa-recovery-input'), {
      target: { value: 'aaaaa-bbbbb' },
    });
    fireEvent.click(screen.getByTestId('mfa-recovery-submit'));
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith('recovery', { payload: { code: 'aaaaa-bbbbb' } }),
    );
  });

  it('第二步作廢的錯誤交給呼叫端（回到密碼），不在表單上顯示', async () => {
    const onError = vi.fn(() => true);
    render(
      <AllProviders>
        <MfaChallengeForm
          factors={[factor('totp')]}
          recoveryAvailable={false}
          requestChallenge={vi.fn()}
          verify={vi.fn(async () => {
            throw new AppError('AUTH_MFA_TOO_MANY_ATTEMPTS', 400);
          })}
          onError={onError}
        />
      </AllProviders>,
    );
    fireEvent.change(await screen.findByTestId('mfa-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('mfa-submit'));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(screen.getByTestId('mfa-error')).toBeEmptyDOMElement();
  });
});

describe('RecoveryCodesDialog（複製與下載）', () => {
  function renderDialog(onDone = vi.fn()) {
    render(
      <AllProviders>
        <RecoveryCodesDialog
          open
          codes={['AAAAA-BBBBB', 'CCCCC-DDDDD']}
          account="me@acme.test"
          onDone={onDone}
          doneLabel="繼續登入"
        />
      </AllProviders>,
    );
  }

  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(writeText) },
    });
    return navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
  }

  it('複製全部的碼（一行一組），成功時提示', async () => {
    const writeText = stubClipboard(async () => undefined);
    renderDialog();

    fireEvent.click(screen.getByTestId('mfa-recovery-copy'));

    expect(await screen.findByText('已複製備用碼。')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('AAAAA-BBBBB\nCCCCC-DDDDD');
  });

  it('剪貼簿不可用時提示手動記下', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError');
    });
    renderDialog();

    fireEvent.click(screen.getByTestId('mfa-recovery-copy'));

    expect(await screen.findByText('無法複製，請手動記下。')).toBeInTheDocument();
  });

  it('下載 recovery-codes-<帳號>.txt，內容有帳號的標題與全部的碼', async () => {
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((value: Blob) => {
      blob = value;
      return 'blob:recovery';
    });
    const revokeObjectURL = vi.fn();
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    onTestFinished(() => {
      Object.assign(URL, original);
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderDialog();

    fireEvent.click(screen.getByTestId('mfa-recovery-download'));

    const downloaded = click.mock.contexts[0] as HTMLAnchorElement | undefined;

    expect(downloaded?.download).toBe('recovery-codes-me@acme.test.txt');
    expect(downloaded?.href).toBe('blob:recovery');
    expect(await blob?.text()).toBe(
      'me@acme.test 的備用碼（每組只能使用一次）\n\nAAAAA-BBBBB\nCCCCC-DDDDD\n',
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovery');
  });

  it('完成鈕的文字可以換；按下後勾選重設', () => {
    const onDone = vi.fn();
    renderDialog(onDone);
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: '繼續登入' }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mfa-recovery-done')).toBeDisabled();
  });
});

/** 伺服器發碼的方式（像 Email）：要先「寄送」才拿得到 challenge。 */
function FakeChallenge({
  factor: current,
  challenge,
  onRequestChallenge,
  requesting,
  onSubmit,
  error,
}: MfaChallengeProps) {
  return (
    <div data-testid="fake-challenge" data-value={current.id}>
      <span data-testid="fake-challenge-id">{challenge?.challengeId ?? ''}</span>
      <button type="button" disabled={requesting} onClick={onRequestChallenge}>
        寄送
      </button>
      <button type="button" onClick={() => onSubmit({ payload: { code: '000000' } })}>
        送出
      </button>
      <span data-testid="fake-error">{error?.message}</span>
    </div>
  );
}

const fakeEmailMethod: MfaMethodUi = {
  ...totpMethod,
  id: 'email',
  labelKey: 'mfa.challenge.recoveryCode',
  Challenge: FakeChallenge,
};

const challengeInfo: MfaChallengeInfo = {
  challengeId: 'ch-1',
  hint: 'a***@acme.test',
  expiresAt: '2026-10-08T00:10:00.000Z',
  resendAvailableAt: '2026-10-08T00:01:00.000Z',
};

describe('MfaChallengeForm（多個方式與伺服器發碼）', () => {
  beforeEach(() => {
    registerMfaMethod(fakeEmailMethod);
  });

  function renderForm(props: Partial<Parameters<typeof MfaChallengeForm>[0]> = {}) {
    const verify = vi.fn(async () => undefined);
    const requestChallenge = vi.fn(async () => challengeInfo);
    render(
      <AllProviders>
        <MfaChallengeForm
          factors={[factor('email', { label: '公司信箱', hint: 'a***@acme.test' }), factor('totp')]}
          recoveryAvailable
          requestChallenge={requestChallenge}
          verify={verify}
          {...props}
        />
      </AllProviders>,
    );
    return { verify, requestChallenge };
  }

  it('有多個方式時可以選；說明是因子的名稱與提示', async () => {
    renderForm();
    const choice = screen.getByTestId('mfa-factor-choice');
    expect(choice).toHaveTextContent('公司信箱 · a***@acme.test');
    expect(screen.getByTestId('fake-challenge')).toHaveAttribute('data-value', 'email-1');

    fireEvent.click(screen.getAllByRole('radio')[1]!);

    expect(await screen.findByTestId('mfa-code')).toBeInTheDocument();
    expect(screen.queryByTestId('fake-challenge')).not.toBeInTheDocument();
  });

  it('寄送之後拿到 challenge，送出時帶上 challengeId', async () => {
    const { verify, requestChallenge } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: '寄送' }));
    await waitFor(() => expect(screen.getByTestId('fake-challenge-id')).toHaveTextContent('ch-1'));
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(requestChallenge).toHaveBeenCalledWith('email-1');
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith('email-1', {
        payload: { code: '000000' },
        challengeId: 'ch-1',
      }),
    );
  });

  it('寄送失敗時在方式的元件裡顯示錯誤，按鈕恢復可按', async () => {
    renderForm({
      requestChallenge: vi.fn(async () => {
        throw new AppError('AUTH_MFA_PENDING_INVALID', 400);
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: '寄送' }));

    await waitFor(() => expect(screen.getByTestId('fake-error')).not.toBeEmptyDOMElement());
    expect(screen.getByRole('button', { name: '寄送' })).toBeEnabled();
  });

  it('驗證失敗、呼叫端沒有處理時，錯誤顯示在表單上', async () => {
    const onError = vi.fn(() => false);
    renderForm({
      verify: vi.fn(async () => {
        throw new AppError('AUTH_MFA_INVALID_CODE', 400);
      }),
      onError,
    });

    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    await waitFor(() => expect(screen.getByTestId('fake-error')).not.toBeEmptyDOMElement());
    expect(onError).toHaveBeenCalled();
  });

  it('改用備用碼再切回驗證方式；備用碼空白時不能送出', async () => {
    renderForm();

    fireEvent.click(screen.getByTestId('mfa-use-recovery'));
    const input = await screen.findByTestId('mfa-recovery-input');
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByTestId('mfa-recovery-submit')).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByTestId('mfa-recovery-submit')).toBeDisabled();

    fireEvent.click(screen.getByTestId('mfa-use-factor'));

    expect(screen.getByTestId('mfa-challenge')).toBeInTheDocument();
  });

  it('沒有備用碼時不出現「改用備用碼」', () => {
    renderForm({ recoveryAvailable: false });
    expect(screen.queryByTestId('mfa-use-recovery')).not.toBeInTheDocument();
  });

  it('只有不支援的方式時，備用碼表單不出現「改用驗證方式」', () => {
    renderForm({ factors: [factor('webauthn')] });
    expect(screen.getByTestId('mfa-recovery-form')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-use-factor')).not.toBeInTheDocument();
  });
});
