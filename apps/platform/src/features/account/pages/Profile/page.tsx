import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { Separator } from '@b2b-system/ui/Separator';
import { ChangePasswordSection, useChangePasswordForm } from '@b2b-system/web-core/components';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { MfaSecuritySection } from '@b2b-system/web-core/mfa';
import { useToast } from '@b2b-system/web-core/notify';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getChangePasswordMutationOptions } from '@/apis/auth/change-password/mutation';
import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getUpdateProfileMutationOptions } from '@/apis/auth/update-profile/mutation';
import { invalidateResources, selfUpdated } from '@/apis/resources';

import { PLATFORM_ROLE_LABEL_KEY } from '../../constants';
import { mfaSelfApi } from '../../hooks/mfaSelfApi';
import { ProfilePermissionSection } from './components/ProfilePermissionSection';

/** 平台管理者自己的資料：名稱、角色與權限（唯讀）、變更密碼。結構同 backstage 的個人資料頁。 */
export default function ProfilePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const showError = useErrorToast();
  const profile = useQuery(getAuthProfileQueryOptions());
  const admin = profile.data?.admin;

  // 草稿為 undefined 時顯示伺服器上的值（不用 effect 同步）
  const [draftDisplayName, setDisplayName] = useState<string>();
  const displayName = draftDisplayName ?? admin?.displayName ?? '';

  const updateProfile = useMutation({
    ...getUpdateProfileMutationOptions(),
    onSuccess: (updated) => {
      setDisplayName(undefined);
      invalidateResources(selfUpdated(updated));
      toast.success(t('account.profile.saved'));
    },
    onError: showError,
  });

  const password = useChangePasswordForm({ mutationOptions: getChangePasswordMutationOptions() });

  const profileDirty = draftDisplayName !== undefined && draftDisplayName !== admin?.displayName;
  // 頁面型表單：換頁與重新整理前提醒未儲存的修改
  useUnsavedChangesGuard(profileDirty || password.isDirty);

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
          <Input value={admin?.email ?? ''} disabled />
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
          <p className="mb-1 text-sm">{t('account.field.role')}</p>
          {admin && (
            <Chip tone="brand" data-testid="profile-role" data-value={admin.role}>
              {t(PLATFORM_ROLE_LABEL_KEY[admin.role])}
            </Chip>
          )}
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

      <ChangePasswordSection form={password} username={admin?.email ?? ''} />

      <Separator />

      <MfaSecuritySection api={mfaSelfApi} account={admin?.email ?? ''} />

      {profile.data && (
        <>
          <Separator />
          <ProfilePermissionSection permissions={profile.data.permissions} />
        </>
      )}
    </div>
  );
}
