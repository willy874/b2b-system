import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { RefObject } from 'react';

import { PASSWORD_CHANGED_REASON, sessionStore } from '../../auth';
import type { HttpRequestDTO } from '../../client';
import { useErrorMessage, useServerFieldErrors } from '../../errors';
import { useTranslation } from '../../locales';
import { useToast } from '../../notify';

/** 與後端的密碼規則一致（apps/api/src/modules/credential/password.ts 的 `PasswordSchema`）。 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const PASSWORD_FIELDS = ['currentPassword', 'newPassword'] as const;
type PasswordField = (typeof PASSWORD_FIELDS)[number];

/** 兩個 app 的 `POST …/auth/change-password` 的請求形狀相同，端點不同。 */
export type ChangePasswordRequest = HttpRequestDTO<{
  currentPassword: string;
  newPassword: string;
}>;

export interface UseChangePasswordFormOptions {
  /** app 的 `getChangePasswordMutationOptions()`（backstage 打 `/auth/*`，apps/platform 打 `/platform/auth/*`）。 */
  mutationOptions: { mutationFn: (request: ChangePasswordRequest) => Promise<unknown> };
}

export interface ChangePasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  setCurrentPassword: (value: string) => void;
  setNewPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  /** 新密碼已輸入但不到最短長度 */
  tooShort: boolean;
  /** 確認欄已輸入但與新密碼不同 */
  mismatch: boolean;
  canSubmit: boolean;
  /** 有填了還沒送出的密碼：頁面的未儲存提醒要算進去 */
  isDirty: boolean;
  isPending: boolean;
  /** 欄位下方的伺服器錯誤（目前密碼錯、新密碼太弱） */
  fieldErrors: Partial<Record<PasswordField, string>>;
  fieldErrorCodes: Partial<Record<PasswordField, string>>;
  /** 欄位以外的錯誤，顯示在表單底部 */
  formError: string | undefined;
  /** 交給 `<form ref>`：伺服器回欄位錯誤時聚焦到第一個錯的欄位 */
  formRef: RefObject<HTMLFormElement | null>;
  /** 先確認（所有裝置都會登出），再送出 */
  submit: () => Promise<void>;
}

/**
 * 個人資料頁的「變更密碼」（兩個 app 共用）：欄位狀態、長度與一致性檢查、確認後送出。
 * 成功後所有 refresh token 都被撤銷（包含這一個），以 `PASSWORD_CHANGED_REASON` 結束 session：
 * 登入頁依它說明「密碼已變更，請用新密碼登入」。
 */
export function useChangePasswordForm({
  mutationOptions,
}: UseChangePasswordFormOptions): ChangePasswordForm {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const toMessage = useErrorMessage();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string>();
  const { errors, codes, report, clear, formRef } = useServerFieldErrors(PASSWORD_FIELDS, {
    AUTH_PASSWORD_MISMATCH: 'currentPassword',
    AUTH_PASSWORD_WEAK: 'newPassword',
  });
  const changePassword = useMutation(mutationOptions);

  const tooShort = newPassword.length > 0 && newPassword.length < PASSWORD_MIN_LENGTH;
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= PASSWORD_MIN_LENGTH &&
    confirmPassword === newPassword;

  const submit = async () => {
    setFormError(undefined);
    // 變更後所有裝置（包含這一個）都會登出：事先說清楚
    await confirm({
      title: t('changePassword.confirmTitle'),
      description: t('changePassword.hint'),
      confirmLabel: t('changePassword.submit'),
      tone: 'primary',
      'data-testid': 'profile-change-password-confirm',
      onConfirm: async () => {
        // 後端撤銷 session 的推播可能比回應先到：先預告原因，登入頁才會說「密碼已變更」
        const cancelExpectedEnd = sessionStore.expectSessionEnd(PASSWORD_CHANGED_REASON);
        try {
          await changePassword.mutateAsync({ params: { currentPassword, newPassword } });
        } catch (error) {
          cancelExpectedEnd();
          // 目前密碼錯、新密碼太弱 → 顯示在欄位下方；其他錯誤顯示在表單底部
          if (!report(error)) setFormError(toMessage(error));
          return;
        }
        toast.success(t('changePassword.changed'));
        setCurrent('');
        setNew('');
        setConfirmPassword('');
        // 變更密碼會撤銷所有 refresh token，包含當前這一條
        sessionStore.endSession(PASSWORD_CHANGED_REASON);
      },
    });
  };

  return {
    currentPassword,
    newPassword,
    confirmPassword,
    setCurrentPassword: (value) => {
      clear('currentPassword');
      setCurrent(value);
    },
    setNewPassword: (value) => {
      clear('newPassword');
      setNew(value);
    },
    setConfirmPassword,
    tooShort,
    mismatch,
    canSubmit,
    isDirty: currentPassword.length > 0 || newPassword.length > 0,
    isPending: changePassword.isPending,
    fieldErrors: errors,
    fieldErrorCodes: codes,
    formError,
    formRef,
    submit,
  };
}
