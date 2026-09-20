import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getChangePasswordMutationOptions } from '@/apis/auth/change-password/mutation';
import { AUTH_PROFILE_QUERY_KEY, getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getUpdateProfileMutationOptions } from '@/apis/auth/update-profile/mutation';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Separator } from '@/components/Separator';
import { useToast } from '@/components/Toast';
import { sessionStore } from '@/core/auth';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

export default function ProfilePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const profile = useQuery(getAuthProfileQueryOptions());

  // 草稿為 undefined 時顯示伺服器上的值（不用 effect 同步）
  const [draftDisplayName, setDisplayName] = useState<string>();
  const displayName = draftDisplayName ?? profile.data?.user.displayName ?? '';

  const updateProfile = useMutation({
    ...getUpdateProfileMutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [AUTH_PROFILE_QUERY_KEY] });
      toast.success(t('account.profile.saved'));
    },
    onError: (error) => toast.error(toMessage(error)),
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const changePassword = useMutation({
    ...getChangePasswordMutationOptions(),
    onSuccess: () => {
      toast.success(t('account.password.changed'));
      setCurrentPassword('');
      setNewPassword('');
      // 變更密碼會撤銷所有 refresh token，包含當前這一條
      sessionStore.endSession('password_changed');
    },
    onError: (error) => toast.error(toMessage(error)),
  });

  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="profile-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('account.profile.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('account.profile.description')}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <Field label={t('account.field.email')}>
          <Input value={profile.data?.user.email ?? ''} disabled />
        </Field>
        <Field label={t('account.field.displayName')}>
          <Input
            value={displayName}
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
            loading={updateProfile.isPending}
            onClick={() => updateProfile.mutate({ params: { displayName } })}
            data-testid="profile-save"
          >
            {t('common.save')}
          </Button>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-medium">{t('account.password.title')}</h2>
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('account.password.hint')}</p>
        <Field label={t('auth.field.currentPassword')} required>
          <Input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            data-testid="profile-current-password"
          />
        </Field>
        <Field label={t('auth.field.newPassword')} required>
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            data-testid="profile-new-password"
          />
        </Field>
        <div className="flex justify-end">
          <Button
            variant="primary"
            loading={changePassword.isPending}
            disabled={!currentPassword || newPassword.length < 12}
            onClick={() => changePassword.mutate({ params: { currentPassword, newPassword } })}
            data-testid="profile-change-password"
          >
            {t('account.password.submit')}
          </Button>
        </div>
      </section>
    </div>
  );
}
