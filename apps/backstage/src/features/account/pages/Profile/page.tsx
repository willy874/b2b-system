import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { Separator } from '@b2b-system/ui/Separator';
import { sessionStore } from '@b2b-system/web-core/auth';
import { useErrorMessage, useErrorToast, useServerFieldErrors } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getChangePasswordMutationOptions } from '@/apis/auth/change-password/mutation';
import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getUpdateProfileMutationOptions } from '@/apis/auth/update-profile/mutation';
import { invalidateResources, selfUpdated } from '@/apis/resources';

import { ProfileApiTokenSection } from './components/ProfileApiTokenSection';
import { ProfilePermissionSection } from './components/ProfilePermissionSection';

/** 與後端的密碼規則一致（apps/api/src/modules/credential/password.ts 的 `PasswordSchema`）。 */
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_FIELDS = ['currentPassword', 'newPassword'] as const;

/**
 * 變更密碼會撤銷所有 refresh token；登入頁依這個原因說明「密碼已變更，請用新密碼登入」
 * （與 features/auth 的 PASSWORD_CHANGED_REASON 相同；feature 之間不直接 import）。
 */
const PASSWORD_CHANGED_REASON = 'password_changed';

export default function ProfilePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const toMessage = useErrorMessage();
  const profile = useQuery(getAuthProfileQueryOptions());

  // 草稿為 undefined 時顯示伺服器上的值（不用 effect 同步）
  const [draftDisplayName, setDisplayName] = useState<string>();
  const displayName = draftDisplayName ?? profile.data?.user.displayName ?? '';

  const updateProfile = useMutation({
    ...getUpdateProfileMutationOptions(),
    onSuccess: (updated) => {
      setDisplayName(undefined);
      invalidateResources([selfUpdated(updated)]);
      toast.success(t('account.profile.saved'));
    },
    onError: showError,
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string>();
  const {
    errors: serverErrors,
    codes: serverErrorCodes,
    report: reportServerError,
    clear: clearServerError,
    formRef: passwordFormRef,
  } = useServerFieldErrors(PASSWORD_FIELDS, {
    AUTH_PASSWORD_MISMATCH: 'currentPassword',
    AUTH_PASSWORD_WEAK: 'newPassword',
  });
  const changePassword = useMutation(getChangePasswordMutationOptions());

  const tooShort = newPassword.length > 0 && newPassword.length < PASSWORD_MIN_LENGTH;
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canChangePassword =
    currentPassword.length > 0 &&
    newPassword.length >= PASSWORD_MIN_LENGTH &&
    confirmPassword === newPassword;

  const profileDirty =
    draftDisplayName !== undefined && draftDisplayName !== profile.data?.user.displayName;
  // 頁面型表單：換頁與重新整理前提醒未儲存的修改
  useUnsavedChangesGuard(profileDirty || currentPassword.length > 0 || newPassword.length > 0);

  const submitPassword = async () => {
    setPasswordError(undefined);
    // 變更後所有裝置（包含這一個）都會登出：事先說清楚
    await confirm({
      title: t('account.password.confirmTitle'),
      description: t('account.password.hint'),
      confirmLabel: t('account.password.submit'),
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
          if (!reportServerError(error)) setPasswordError(toMessage(error));
          return;
        }
        toast.success(t('account.password.changed'));
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        // 變更密碼會撤銷所有 refresh token，包含當前這一條
        sessionStore.endSession(PASSWORD_CHANGED_REASON);
      },
    });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="profile-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('account.profile.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('account.profile.description')}
        </p>
      </header>

      {/* <form>：在欄位按 Enter 就能儲存 */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          updateProfile.mutate({ params: { displayName } });
        }}
      >
        <Field label={t('account.field.email')}>
          <Input value={profile.data?.user.email ?? ''} disabled />
        </Field>
        <Field label={t('account.field.displayName')}>
          <Input
            value={displayName}
            maxLength={100}
            onChange={(event) => setDisplayName(event.target.value)}
            data-testid="profile-display-name"
          />
        </Field>
        <div>
          <p className="mb-1 text-sm">{t('account.field.roles')}</p>
          <div className="flex flex-wrap gap-1">
            {profile.data?.roles.map((role) => (
              <Chip key={role.id} tone={role.isSystem ? 'brand' : 'neutral'}>
                {role.name}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="primary"
            type="submit"
            disabled={!displayName.trim()}
            loading={updateProfile.isPending}
            data-testid="profile-save"
          >
            {t('common.save')}
          </Button>
        </div>
      </form>

      <Separator />

      <form
        ref={passwordFormRef}
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canChangePassword) void submitPassword();
        }}
        data-testid="profile-password-form"
      >
        <h2 className="m-0 text-base font-medium">{t('account.password.title')}</h2>
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('account.password.hint')}</p>
        {/* 讓密碼管理器知道是哪個帳號的密碼，才會提示儲存新密碼 */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={profile.data?.user.email ?? ''}
          readOnly
          hidden
        />
        <Field
          label={t('account.field.currentPassword')}
          required
          error={serverErrors.currentPassword}
          errorCode={serverErrorCodes.currentPassword}
        >
          <Input
            type="password"
            autoComplete="current-password"
            maxLength={PASSWORD_MAX_LENGTH}
            value={currentPassword}
            onChange={(event) => {
              clearServerError('currentPassword');
              setCurrentPassword(event.target.value);
            }}
            data-testid="profile-current-password"
          />
        </Field>
        <Field
          label={t('account.field.newPassword')}
          required
          // 即時說明長度要求，而不是只把按鈕停用
          description={t('account.password.lengthHint', {
            min: PASSWORD_MIN_LENGTH,
            count: newPassword.length,
          })}
          error={
            serverErrors.newPassword ??
            (tooShort ? t('validation.tooShort', { min: PASSWORD_MIN_LENGTH }) : undefined)
          }
          errorCode={serverErrorCodes.newPassword}
        >
          <Input
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX_LENGTH}
            value={newPassword}
            onChange={(event) => {
              clearServerError('newPassword');
              setNewPassword(event.target.value);
            }}
            data-testid="profile-new-password"
          />
        </Field>
        <Field
          label={t('account.field.confirmPassword')}
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
        <FormError>{passwordError}</FormError>
        <div className="flex justify-end">
          <Button
            variant="primary"
            type="submit"
            loading={changePassword.isPending}
            disabled={!canChangePassword}
            data-testid="profile-change-password"
          >
            {t('account.password.submit')}
          </Button>
        </div>
      </form>

      {profile.data && (
        <>
          <Separator />
          <ProfilePermissionSection userId={profile.data.user.id} />
          <Separator />
          <ProfileApiTokenSection />
        </>
      )}
    </div>
  );
}
