import { AppError } from '@b2b-system/web-core/errors';
import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MfaMethodSettings, PlatformMfaMethod } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../../locales/zh_TW.json';
import { isFieldVisible, MfaMethodSettingsDialog } from '../components/MfaMethodSettingsDialog';

const { getSettings, saveSettings, clearSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  clearSettings: vi.fn(),
}));
vi.mock('@/apis/platform-mfa-method/get-mfa-method-settings/fetcher', () => ({
  fetchMfaMethodSettingsQuery: getSettings,
}));
vi.mock('@/apis/platform-mfa-method/save-mfa-method-settings/fetcher', () => ({
  fetchSaveMfaMethodSettingsMutation: saveSettings,
}));
vi.mock('@/apis/platform-mfa-method/clear-mfa-method-settings/fetcher', () => ({
  fetchClearMfaMethodSettingsMutation: clearSettings,
}));

const SMS: PlatformMfaMethod = {
  id: 'sms',
  challenge: 'server',
  enrollChallenge: 'immediate',
  enrollAt: 'anywhere',
  assurance: 'messaging',
  maxFactorsPerAccount: 2,
  settings: {
    configured: false,
    fields: [
      {
        key: 'provider',
        type: 'select',
        required: true,
        options: ['twilio', 'webhook'],
        defaultValue: 'twilio',
      },
      {
        key: 'twilioAccountSid',
        type: 'text',
        required: true,
        requiredWhen: { key: 'provider', equals: 'twilio' },
      },
      {
        key: 'twilioAuthToken',
        type: 'secret',
        required: true,
        requiredWhen: { key: 'provider', equals: 'twilio' },
      },
      {
        key: 'webhookUrl',
        type: 'url',
        required: true,
        requiredWhen: { key: 'provider', equals: 'webhook' },
      },
      { key: 'allowedCountryCodes', type: 'text', required: true, defaultValue: '886' },
    ],
  },
  realms: ['tenant', 'platform'],
  defaultEnabled: false,
  globalState: 'default',
  effective: false,
  tenantOverrides: { on: 0, off: 0 },
  stats: null,
  platformAdminEnabled: false,
};

const EMPTY: MfaMethodSettings = {
  method: 'sms',
  values: {},
  secrets: { twilioAuthToken: false },
  configured: false,
  version: null,
  updatedAt: null,
};

function render(settings: MfaMethodSettings = EMPTY, canUpdate = true) {
  getSettings.mockResolvedValue(settings);
  const onClose = vi.fn();
  renderWithPermissions(
    <MfaMethodSettingsDialog
      method={SMS}
      label="簡訊驗證碼"
      canUpdate={canUpdate}
      onClose={onClose}
    />,
    ['mfaMethod:read', 'mfaMethod:update'],
  );
  return { onClose };
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  getSettings.mockReset();
  saveSettings.mockReset().mockResolvedValue({ ...EMPTY, configured: true, version: 1 });
  clearSettings.mockReset();
});

describe('MfaMethodSettingsDialog（docs/architecture/backend/21-mfa.md §5.1）', () => {
  it('isFieldVisible：有 requiredWhen 的欄位只在條件成立時出現', () => {
    const sid = SMS.settings!.fields[1]!;
    expect(isFieldVisible(sid, { provider: 'twilio' })).toBe(true);
    expect(isFieldVisible(sid, { provider: 'webhook' })).toBe(false);
  });

  it('還沒儲存過：帶入預設值，只顯示目前供應商的欄位；換供應商時換欄位', async () => {
    render();
    expect(await screen.findByTestId('mfa-setting-allowedCountryCodes')).toHaveValue('886');
    expect(screen.getByTestId('mfa-setting-twilioAccountSid')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-setting-webhookUrl')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('mfa-setting-provider'));
    const webhook = (await screen.findAllByRole('option')).find(
      (el) => el.dataset.value === 'webhook',
    );
    await userEvent.click(webhook!);
    expect(await screen.findByTestId('mfa-setting-webhookUrl')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-setting-twilioAccountSid')).not.toBeInTheDocument();
  });

  it('送出：只送顯示中的欄位、帶讀到的版本；機密只在有輸入時送出', async () => {
    const { onClose } = render();
    fireEvent.change(await screen.findByTestId('mfa-setting-twilioAccountSid'), {
      target: { value: 'AC1' },
    });
    fireEvent.change(screen.getByTestId('mfa-setting-twilioAuthToken'), {
      target: { value: 'tok' },
    });
    fireEvent.click(screen.getByTestId('mfa-method-settings-save'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(saveSettings.mock.calls[0]![0]).toEqual({
      params: {
        id: 'sms',
        values: { provider: 'twilio', twilioAccountSid: 'AC1', allowedCountryCodes: '886' },
        secrets: { twilioAuthToken: 'tok' },
        version: null,
      },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('已儲存的機密：顯示「已設定」、留空沿用（不送出）', async () => {
    render({
      ...EMPTY,
      values: { provider: 'twilio', twilioAccountSid: 'AC1', allowedCountryCodes: '886' },
      secrets: { twilioAuthToken: true },
      configured: true,
      version: 3,
    });
    expect(await screen.findByTestId('mfa-setting-twilioAuthToken')).toHaveAttribute(
      'placeholder',
      zhTW.mfaMethod.settings.secretKept,
    );
    fireEvent.click(screen.getByTestId('mfa-method-settings-save'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(saveSettings.mock.calls[0]![0].params).toMatchObject({ secrets: {}, version: 3 });
    expect(screen.getByTestId('mfa-method-settings-clear')).toBeInTheDocument();
  });

  it('供應商拒絕：欄位下方顯示原因，對話框不關', async () => {
    saveSettings.mockRejectedValue(
      new AppError('MFA_METHOD_SETTINGS_CHECK_FAILED', 400, {
        fields: { twilioAuthToken: 'MFA_SETTING_REJECTED' },
      }),
    );
    const { onClose } = render();
    fireEvent.change(await screen.findByTestId('mfa-setting-twilioAccountSid'), {
      target: { value: 'AC1' },
    });
    fireEvent.change(screen.getByTestId('mfa-setting-twilioAuthToken'), {
      target: { value: 'bad' },
    });
    fireEvent.click(screen.getByTestId('mfa-method-settings-save'));
    expect(await screen.findByText('供應商拒絕了這個值，請確認是否正確')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-method-settings-error')).toHaveAttribute(
      'data-value',
      'MFA_METHOD_SETTINGS_CHECK_FAILED',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('沒有修改權限：欄位停用、沒有儲存鈕', async () => {
    render(EMPTY, false);
    expect(await screen.findByTestId('mfa-setting-twilioAccountSid')).toBeDisabled();
    expect(screen.queryByTestId('mfa-method-settings-save')).not.toBeInTheDocument();
  });
});
