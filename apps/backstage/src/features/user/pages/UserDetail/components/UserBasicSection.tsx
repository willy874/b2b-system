import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { isVersionConflict, useErrorToast } from '@b2b-system/web-core/errors';
import { FormDraftNotice, useFormDraft } from '@b2b-system/web-core/form';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { getUserDetailQueryOptions } from '@/apis/user/get-user-detail/query';
import { VersionConflictAlert } from '@/core/components';
import type { UpdateUserRequest, User } from '@/shared/api-sdk';

import { USER_STATUS_LABEL_KEY, USER_STATUS_TONE } from '../../../constants';
import { useUserUnlockMutation, useUserUpdateMutation } from '../../../hooks/useUserMutations';

type EditableStatus = NonNullable<UpdateUserRequest['status']>;

interface UserBasicSectionProps {
  user: User;
  canUpdate: boolean;
  /** 不能編輯自己 */
  isSelf: boolean;
}

/**
 * 使用者基本資料：檢視 ／ 就地編輯顯示名稱與狀態。
 * 送出時帶「開始編輯時」的 `version`，不是畫面上最新的：編輯途中推播讓資料重抓時，
 * 帶最新的版本等於默默蓋掉別人的變更（樂觀鎖，docs/architecture/backend/03-api-conventions.md §11）。
 */
export function UserBasicSection({ user, canUpdate, isSelf }: UserBasicSectionProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  const updateUser = useUserUpdateMutation();
  const unlockUser = useUserUnlockMutation();
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<EditableStatus>('active');
  const [baseVersion, setBaseVersion] = useState(user.version);
  const [editing, setEditing] = useState(false);
  const [reloading, setReloading] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // 鎖定不是可以「選」的狀態：只能解鎖。編輯時不動狀態，免得改個名字就順便把帳號解鎖
  const isLocked = user.status === 'locked';
  // 還沒啟用的人只能靠啟用信變成 active：不提供狀態選單（API 也不接受改回 pending）
  const canEditStatus = !isLocked && user.status !== 'pending';
  const dirty =
    editing && (displayName !== user.displayName || (canEditStatus && status !== user.status));
  useUnsavedChangesGuard(dirty);
  // session 非自願結束時保留編輯中的內容（含開始編輯時的版本，還原後送出照常以它做樂觀鎖）
  const formDraft = useFormDraft({
    key: `user.detail:${user.id}`,
    values: { displayName, status, baseVersion },
    dirty,
    onRestore: (saved) => {
      if (saved.displayName === undefined || saved.baseVersion === undefined) return;
      setDisplayName(saved.displayName);
      if (saved.status) setStatus(saved.status);
      setBaseVersion(saved.baseVersion);
      updateUser.reset();
      setEditing(true);
    },
  });

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  const startEditing = (source: User) => {
    setDisplayName(source.displayName);
    setStatus(source.status === 'inactive' ? 'inactive' : 'active');
    setBaseVersion(source.version);
    updateUser.reset();
    setEditing(true);
  };

  /** 衝突後放棄這次的修改：重抓最新的內容與版本，表單改成以它為基礎。 */
  const reload = async () => {
    setReloading(true);
    try {
      startEditing(
        await queryClient.fetchQuery({ ...getUserDetailQueryOptions(user.id), staleTime: 0 }),
      );
    } catch (error) {
      showError(error);
    } finally {
      setReloading(false);
    }
  };

  const save = async () => {
    // 只送出有變動的欄位
    const fields: Omit<UpdateUserRequest, 'version'> = {};
    if (displayName !== user.displayName) fields.displayName = displayName;
    if (canEditStatus && status !== user.status) fields.status = status;
    if (Object.keys(fields).length === 0) {
      setEditing(false);
      return;
    }
    const body: UpdateUserRequest = { ...fields, version: baseVersion };
    const submit = () => updateUser.mutateAsync({ params: { userId: user.id, body } });

    if (body.status === 'inactive') {
      let conflicted = false;
      // 停用會立即登出對方：與批次停用一樣先說清楚
      const confirmed = await confirm({
        title: t('user.deactivate.title'),
        description: t('user.deactivate.confirm', { name: user.displayName }),
        confirmLabel: t('user.deactivate.action'),
        tone: 'danger',
        onConfirm: () =>
          submit().catch((error: unknown) => {
            // 衝突：關掉確認框，訊息與「重新載入」顯示在表單上；其他錯誤留在確認框讓人重試
            if (!isVersionConflict(error)) throw error;
            conflicted = true;
          }),
        'data-testid': 'user-deactivate-confirm',
      });
      if (confirmed && !conflicted) setEditing(false);
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
      {canUpdate && !editing && <FormDraftNotice draft={formDraft} />}
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
                onClick={() => startEditing(user)}
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
          {isVersionConflict(updateUser.error) && (
            <VersionConflictAlert
              error={updateUser.error}
              onReload={() => void reload()}
              reloading={reloading}
            />
          )}
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
