import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import { AllProviders } from '../../testing/renderWithPermissions';
import { CodeInput } from '../components/CodeInput';
import { FactorList } from '../components/FactorList';
import { MfaChallengeForm } from '../components/MfaChallengeForm';
import { RecoveryCodesDialog } from '../components/RecoveryCodesDialog';
import { totpMethod } from '../methods/totp';
import { mfaMethodRegistry, registerMfaMethod, requireMfaMethod } from '../registry';
import type { MfaFactorView } from '../types';

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
