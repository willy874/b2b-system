import { Avatar } from '@b2b-system/ui/Avatar';
import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { Separator } from '@b2b-system/ui/Separator';
import { ChangePasswordSection, useChangePasswordForm } from '@b2b-system/web-core/components';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { coalesce } from '@b2b-system/web-core/image';
import { ImageField } from '@b2b-system/web-core/image-picker';
import { useTranslation } from '@b2b-system/web-core/locales';
import { MfaSecuritySection } from '@b2b-system/web-core/mfa';
import { useToast } from '@b2b-system/web-core/notify';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getChangePasswordMutationOptions } from '@/apis/auth/change-password/mutation';
import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getUpdateProfileMutationOptions } from '@/apis/auth/update-profile/mutation';
import { USER_AVATAR_USAGE } from '@/apis/image/types';
import { invalidateResources, Resource, selfUpdated } from '@/apis/resources';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

import { mfaSelfApi } from '../../hooks/mfaSelfApi';
import { ProfileApiTokenSection } from './components/ProfileApiTokenSection';
import { ProfilePermissionSection } from './components/ProfilePermissionSection';

export default function ProfilePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const showError = useErrorToast();
  const profile = useQuery(getAuthProfileQueryOptions());
  // 個人 API token 屬於 `externalApi`（docs/architecture/06-external-api.md §3.1）
  const hasApiTokens = useIsFeatureReady(TenantFeature.externalApi);

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

  // 頭像（docs/architecture/frontend/23-image-picker.md §8）：換了就存，不跟著「儲存」按鈕
  const updateAvatar = useMutation({
    ...getUpdateProfileMutationOptions(),
    onSuccess: (updated) => {
      invalidateResources([selfUpdated(updated)]);
      toast.success(t('account.profile.avatarSaved'));
    },
    onError: showError,
  });
  // 網址過期（頁面開很久）：重抓 profile 拿新的網址
  const onAvatarExpired = useMemo(
    () => coalesce(() => invalidateResources([{ resource: Resource.PROFILE, kind: 'update' }])),
    [],
  );

  const password = useChangePasswordForm({ mutationOptions: getChangePasswordMutationOptions() });

  const profileDirty =
    draftDisplayName !== undefined && draftDisplayName !== profile.data?.user.displayName;
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

      <section className="flex flex-col gap-2" aria-labelledby="profile-avatar-title">
        <h2 id="profile-avatar-title" className="m-0 text-sm font-medium">
          {t('account.field.avatar')}
        </h2>
        <ImageField
          usage={USER_AVATAR_USAGE}
          value={profile.data?.user.avatar ?? null}
          assetId={profile.data?.user.avatarImageId ?? null}
          variant="lg"
          alt={profile.data?.user.displayName ?? ''}
          shape="circle"
          size={96}
          fallback={<Avatar name={profile.data?.user.displayName || '?'} size={96} />}
          disabled={!profile.data}
          pending={updateAvatar.isPending}
          onChange={({ assetId }) => updateAvatar.mutate({ params: { avatarImageId: assetId } })}
          onRecrop={(crop) => updateAvatar.mutate({ params: { avatarCrop: crop } })}
          onExpired={onAvatarExpired}
          data-testid="profile-avatar"
        />
      </section>

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

      <ChangePasswordSection form={password} username={profile.data?.user.email ?? ''} />

      <Separator />

      <MfaSecuritySection api={mfaSelfApi} account={profile.data?.user.email ?? ''} />

      {profile.data && (
        <>
          <Separator />
          <ProfilePermissionSection userId={profile.data.user.id} />
          {hasApiTokens && (
            <>
              <Separator />
              <ProfileApiTokenSection />
            </>
          )}
        </>
      )}
    </div>
  );
}
