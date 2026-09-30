import { useState } from 'react';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Tooltip } from '@/components/Tooltip';
import { useTranslation } from '@/core/locales';
import type { User } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { USER_STATUS_LABEL_KEY } from '../../../constants';
import { useUserUpdateMutation } from '../../../hooks/useUserMutations';

interface UserBasicSectionProps {
  user: User;
  canUpdate: boolean;
  /** 不能編輯自己 */
  isSelf: boolean;
}

/** 使用者基本資料：檢視 ／ 就地編輯顯示名稱與狀態。 */
export function UserBasicSection({ user, canUpdate, isSelf }: UserBasicSectionProps) {
  const { t } = useTranslation();
  const updateUser = useUserUpdateMutation();
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  // 還沒啟用的人只能靠啟用信變成 active：不提供狀態選單（API 也不接受改回 pending，EDGE-14）
  const canEditStatus = user.status !== 'pending';
  const [editing, setEditing] = useState(false);

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('user.detail.basic')}</h3>
        {canUpdate && !editing && (
          <Tooltip content={isSelf ? t('user.detail.selfHint') : ''}>
            <Button
              size="sm"
              disabled={isSelf}
              onClick={() => {
                setDisplayName(user.displayName);
                setStatus(user.status === 'inactive' ? 'inactive' : 'active');
                setEditing(true);
              }}
              data-testid="user-edit-button"
            >
              {t('common.edit')}
            </Button>
          </Tooltip>
        )}
      </div>

      {editing ? (
        <div className="mt-2 flex flex-col gap-3">
          <Field label={t('user.field.displayName')} required>
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          {canEditStatus && (
            <Field label={t('user.field.status')}>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as typeof status)}
                options={[
                  { value: 'active', label: t('user.status.active') },
                  { value: 'inactive', label: t('user.status.inactive') },
                ]}
              />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={updateUser.isPending}
              onClick={async () => {
                await updateUser
                  .mutateAsync({
                    params: {
                      userId: user.id,
                      body: canEditStatus ? { displayName, status } : { displayName },
                    },
                  })
                  .catch(() => undefined);
                setEditing(false);
              }}
              data-testid="user-save-button"
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('user.field.status')}</dt>
          <dd className="m-0">
            <Chip tone={user.status === 'active' ? 'success' : 'neutral'}>
              {t(USER_STATUS_LABEL_KEY[user.status])}
            </Chip>
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('user.field.username')}</dt>
          <dd className="m-0">{user.username ?? '-'}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('user.field.lastLoginAt')}</dt>
          <dd className="m-0">{formatDateTime(user.lastLoginAt)}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('user.field.createdAt')}</dt>
          <dd className="m-0">{formatDateTime(user.createdAt)}</dd>
        </dl>
      )}
    </section>
  );
}
