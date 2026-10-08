import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MfaPolicy } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { useMfaPolicyForm } from '../useMfaPolicyForm';

const api = vi.hoisted(() => ({ fetch: vi.fn(), preview: vi.fn(), update: vi.fn() }));
vi.mock('@/apis/mfa-policy/get-mfa-policy/fetcher', () => ({ fetchMfaPolicyQuery: api.fetch }));
vi.mock('@/apis/mfa-policy/preview-mfa-policy/fetcher', () => ({
  fetchPreviewMfaPolicyMutation: api.preview,
}));
vi.mock('@/apis/mfa-policy/update-mfa-policy/fetcher', () => ({
  fetchUpdateMfaPolicyMutation: api.update,
}));

const POLICY: MfaPolicy = {
  requireAll: false,
  requiredRoleIds: [],
  allowedMethods: null,
  version: 1,
  updatedAt: null,
  methods: [],
  nonCompliant: 0,
};

async function renderLoaded() {
  const { result } = renderHook(() => useMfaPolicyForm(), { wrapper: AllProviders });
  await waitFor(() => expect(result.current.current).toBeDefined());
  return result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  api.fetch.mockResolvedValue(POLICY);
  api.preview.mockResolvedValue({ stranded: 0, nonCompliant: 0 });
  api.update.mockImplementation(({ params }) =>
    Promise.resolve({ ...POLICY, ...params, version: params.version + 1 }),
  );
});

describe('useMfaPolicyForm（docs/architecture/backend/21-mfa.md §6）', () => {
  it('還沒改 → current 是目前的政策、不是 dirty', async () => {
    const result = await renderLoaded();
    expect(result.current.current).toEqual({
      requireAll: false,
      requiredRoleIds: [],
      allowedMethods: null,
    });
    expect(result.current.dirty).toBe(false);
  });

  it('改了 → dirty；改回原值 → 不再 dirty；reset 丟掉草稿', async () => {
    const result = await renderLoaded();
    act(() => result.current.change({ requireAll: true }));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.change({ requireAll: false }));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.change({ requiredRoleIds: ['r1'] }));
    act(() => result.current.reset());
    expect(result.current.current?.requiredRoleIds).toEqual([]);
  });

  it('政策還沒載入時 change 與 save 不做事', async () => {
    api.fetch.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useMfaPolicyForm(), { wrapper: AllProviders });
    act(() => result.current.change({ requireAll: true }));
    expect(result.current.current).toBeUndefined();
    await act(() => result.current.save());
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('沒有人受影響 → 預覽後直接以 version 儲存，草稿清掉並提示', async () => {
    const result = await renderLoaded();
    act(() => result.current.change({ requiredRoleIds: ['r1'] }));
    await act(() => result.current.save());
    expect(api.preview.mock.calls[0]![0].params).toEqual({
      requireAll: false,
      requiredRoleIds: ['r1'],
      allowedMethods: null,
      version: 1,
    });
    expect(api.update.mock.calls[0]![0].params).toMatchObject({
      requiredRoleIds: ['r1'],
      version: 1,
    });
    expect(await screen.findByText('已儲存 MFA 政策。')).toBeInTheDocument();
    expect(result.current.dirty).toBe(false);
    expect(result.current.current?.requiredRoleIds).toEqual(['r1']);
    expect(screen.queryByTestId('security-mfa-confirm')).not.toBeInTheDocument();
  });

  it('有人會無法登入 → 先確認，說明人數；取消就不儲存', async () => {
    api.preview.mockResolvedValue({ stranded: 2, nonCompliant: 0 });
    const result = await renderLoaded();
    act(() => result.current.change({ allowedMethods: ['totp'] }));
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.save();
    });
    const dialog = await screen.findByTestId('security-mfa-confirm');
    expect(within(dialog).getByText(/2 位使用者只剩不允許的驗證方式/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/下一次登入時會被要求/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await act(() => saving);
    expect(api.update).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);
  });

  it('不符合政策的人變多 → 確認後才儲存', async () => {
    api.preview.mockResolvedValue({ stranded: 0, nonCompliant: 5 });
    const result = await renderLoaded();
    act(() => result.current.change({ requireAll: true }));
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.save();
    });
    const dialog = await screen.findByTestId('security-mfa-confirm');
    expect(
      within(dialog).getByText('5 位使用者下一次登入時會被要求先設定驗證方式。'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '儲存' }));
    await act(() => saving);
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it('不符合政策的人沒有變多 → 不必確認', async () => {
    api.fetch.mockResolvedValue({ ...POLICY, nonCompliant: 5 });
    api.preview.mockResolvedValue({ stranded: 0, nonCompliant: 3 });
    const result = await renderLoaded();
    act(() => result.current.change({ requireAll: true }));
    await act(() => result.current.save());
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it('版本衝突 → 丟掉草稿並重新載入，錯誤帶錯誤碼', async () => {
    api.update.mockRejectedValue(new AppError('MFA_POLICY_VERSION_CONFLICT', 409));
    const result = await renderLoaded();
    act(() => result.current.change({ requireAll: true }));
    await act(() => result.current.save());
    expect(result.current.error).toEqual({
      message: 'MFA 政策已被其他人修改，請重新整理後再試。',
      code: 'MFA_POLICY_VERSION_CONFLICT',
    });
    expect(result.current.dirty).toBe(false);
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
  });

  it('其他錯誤 → 保留草稿，錯誤沒有錯誤碼時只有訊息；再改一次就清掉錯誤', async () => {
    api.preview.mockRejectedValue(new Error('boom'));
    const result = await renderLoaded();
    act(() => result.current.change({ requireAll: true }));
    await act(() => result.current.save());
    expect(result.current.error).toEqual({
      message: '發生未預期的錯誤，請稍後再試。',
      code: undefined,
    });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.change({ requireAll: false }));
    expect(result.current.error).toBeUndefined();
  });
});
