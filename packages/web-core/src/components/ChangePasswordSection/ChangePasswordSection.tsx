import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';

import { useTranslation } from '../../locales';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './useChangePasswordForm';
import type { ChangePasswordForm } from './useChangePasswordForm';

export interface ChangePasswordSectionProps {
  /** `useChangePasswordForm()` 的回傳：狀態留在頁面，頁面的未儲存提醒才能一起算（`form.isDirty`）。 */
  form: ChangePasswordForm;
  /** 帳號的 email：讓密碼管理器知道是哪個帳號的密碼，才會提示儲存新密碼。 */
  username: string;
}

/** 個人資料頁的「變更密碼」表單（兩個 app 共用）。testid 沿用 `profile-*`，E2E 以此定位。 */
export function ChangePasswordSection({ form, username }: ChangePasswordSectionProps) {
  const { t } = useTranslation();
  // 先拆開：整個 form 物件帶著 ref，直接讀它的欄位會被 React Compiler 的規則當成在渲染時讀 ref
  const {
    formRef,
    currentPassword,
    newPassword,
    confirmPassword,
    setCurrentPassword,
    setNewPassword,
    setConfirmPassword,
    fieldErrors,
    fieldErrorCodes,
    formError,
    tooShort,
    mismatch,
    canSubmit,
    isPending,
    submit,
  } = form;
  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void submit();
      }}
      data-testid="profile-password-form"
    >
      <h2 className="m-0 text-base font-medium">{t('changePassword.title')}</h2>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('changePassword.hint')}</p>
      {/* 讓密碼管理器知道是哪個帳號的密碼，才會提示儲存新密碼 */}
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
      <Field
        label={t('changePassword.currentPassword')}
        required
        error={fieldErrors.currentPassword}
        errorCode={fieldErrorCodes.currentPassword}
      >
        <Input
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          data-testid="profile-current-password"
        />
      </Field>
      <Field
        label={t('changePassword.newPassword')}
        required
        // 即時說明長度要求，而不是只把按鈕停用
        description={t('changePassword.lengthHint', {
          min: PASSWORD_MIN_LENGTH,
          count: newPassword.length,
        })}
        error={
          fieldErrors.newPassword ??
          (tooShort ? t('validation.tooShort', { min: PASSWORD_MIN_LENGTH }) : undefined)
        }
        errorCode={fieldErrorCodes.newPassword}
      >
        <Input
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          data-testid="profile-new-password"
        />
      </Field>
      <Field
        label={t('changePassword.confirmPassword')}
        required
        error={mismatch ? t('validation.passwordMismatch') : undefined}
      >
        <Input
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          data-testid="profile-confirm-password"
        />
      </Field>
      <FormError>{formError}</FormError>
      <div className="flex justify-end">
        <Button
          variant="primary"
          type="submit"
          loading={isPending}
          disabled={!canSubmit}
          data-testid="profile-change-password"
        >
          {t('changePassword.submit')}
        </Button>
      </div>
    </form>
  );
}
