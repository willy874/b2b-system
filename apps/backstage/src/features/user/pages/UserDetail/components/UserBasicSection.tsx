import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { useConfirm } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Tooltip } from '@/components/Tooltip';
import { useTranslation } from '@/core/locales';
import { useUnsavedChangesGuard } from '@/core/router';
import type { UpdateUserRequest, User } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { USER_STATUS_LABEL_KEY, USER_STATUS_TONE } from '../../../constants';
import { useUserUnlockMutation, useUserUpdateMutation } from '../../../hooks/useUserMutations';

type EditableStatus = NonNullable<UpdateUserRequest['status']>;

interface UserBasicSectionProps {
  user: User;
  canUpdate: boolean;
  /** 不能編輯自己 */
  isSelf: boolean;
}

/** 使用者基本資料：檢視 ／ 就地編輯顯示名稱與狀態。 */
export function UserBasicSection({ user, canUpdate, isSelf }: UserBasicSectionProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const updateUser = useUserUpdateMutation();
  const unlockUser = useUserUnlockMutation();
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<EditableStatus>('active');
  const [editing, setEditing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // 鎖定不是可以「選」的狀態：只能解鎖。編輯時不動狀態，免得改個名字就順便把帳號解鎖
  const isLocked = user.status === 'locked';
  // 還沒啟用的人只能靠啟用信變成 active：不提供狀態選單（API 也不接受改回 pending）
  const canEditStatus = !isLocked && user.status !== 'pending';
  useUnsavedChangesGuard(
    editing && (displayName !== user.displayName || (canEditStatus && status !== user.status)),
  );

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  const save = async () => {
    // 只送出有變動的欄位
    const body: UpdateUserRequest = {};
    if (displayName !== user.displayName) body.displayName = displayName;
    if (canEditStatus && status !== user.status) body.status = status;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    const submit = () => updateUser.mutateAsync({ params: { userId: user.id, body } });

    if (body.status === 'inactive') {
      // 停用會立即登出對方：與批次停用一樣先說清楚
      const confirmed = await confirm({
        title: t('user.deactivate.title'),
        description: t('user.deactivate.confirm', { name: user.displayName }),
        confirmLabel: t('user.deactivate.action'),
        tone: 'danger',
        onConfirm: submit,
        'data-testid': 'user-deactivate-confirm',
      });
      if (confirmed) setEditing(false);
      return;
    }
    try {
      await submit();
    } catch {
      // 錯誤由 mutation 的 onError 顯示；編輯區與輸入保留，讓使用者修正後重送
      return;
    }
    setEditing(false);
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('user.detail.basic')}</h3>
        {canUpdate && !editing && (
          <div className="flex gap-2">
            {isLocked && !isSelf && (
              <Button
                size="sm"
                loading={unlockUser.isPending}
                onClick={() => unlockUser.mutate({ params: { userId: user.id } })}
                data-testid="user-detail-unlock-button"
              >
                {t('user.unlock.action')}
              </Button>
            )}
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
          </div>
        )}
      </div>

      {editing ? (
        // <form>：在欄位按 Enter 就能儲存
        <form
          className="mt-2 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          data-testid="user-edit-form"
        >
          <Field label={t('user.field.displayName')} required>
            <Input
              ref={nameRef}
              value={displayName}
              maxLength={100}
              onChange={(event) => setDisplayName(event.target.value)}
              data-testid="user-display-name-edit-input"
            />
          </Field>
          <Field
            label={t('user.field.status')}
            description={isLocked ? t('user.detail.lockedHint') : undefined}
          >
            {!canEditStatus ? (
              <Chip tone={USER_STATUS_TONE[user.status]}>
                {t(USER_STATUS_LABEL_KEY[user.status])}
              </Chip>
            ) : (
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as EditableStatus)}
                options={[
                  { value: 'active', label: t(USER_STATUS_LABEL_KEY.active) },
                  { value: 'inactive', label: t(USER_STATUS_LABEL_KEY.inactive) },
                ]}
                data-testid="user-status-select"
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={!displayName.trim()}
              loading={updateUser.isPending}
              data-testid="user-save-button"
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('user.field.status')}</dt>
          <dd className="m-0">
            {/* 與列表共用同一組色調 */}
            <Chip tone={USER_STATUS_TONE[user.status]} data-testid="user-status-chip">
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
