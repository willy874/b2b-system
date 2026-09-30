import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { getRoleDetailQueryOptions } from '@/apis/role/get-role-detail/query';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { VersionConflictAlert } from '@/core/components';
import { isVersionConflict, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useUnsavedChangesGuard } from '@/core/router';
import type { Role } from '@/shared/api-sdk';

import { useRoleUpdateMutation } from '../../../hooks/useRoleMutations';

interface RoleBasicSectionProps {
  role: Role;
  /** 有 role:update 且不是系統角色 */
  canEdit: boolean;
}

/**
 * 角色基本資料：檢視 ／ 就地編輯名稱與描述。
 * 送出時帶「開始編輯時」的 `version`，不是畫面上最新的：編輯途中推播讓資料重抓時，
 * 帶最新的版本等於默默蓋掉別人的變更（樂觀鎖，docs/architecture/backend/03-api-conventions.md §11）。
 */
export function RoleBasicSection({ role, canEdit }: RoleBasicSectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  const updateRole = useRoleUpdateMutation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseVersion, setBaseVersion] = useState(role.version);
  const [reloading, setReloading] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useUnsavedChangesGuard(
    editing && (name !== role.name || description !== (role.description ?? '')),
  );

  // 進入編輯時把游標放在名稱欄，鍵盤使用者不用再找
  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  const startEditing = (source: Role) => {
    setName(source.name);
    setDescription(source.description ?? '');
    setBaseVersion(source.version);
    updateRole.reset();
    setEditing(true);
  };

  /** 衝突後放棄這次的修改：重抓最新的內容與版本，表單改成以它為基礎。 */
  const reload = async () => {
    setReloading(true);
    try {
      startEditing(
        await queryClient.fetchQuery({ ...getRoleDetailQueryOptions(role.id), staleTime: 0 }),
      );
    } catch (error) {
      showError(error);
    } finally {
      setReloading(false);
    }
  };

  const save = async () => {
    try {
      await updateRole.mutateAsync({
        params: { roleId: role.id, body: { name, description, version: baseVersion } },
      });
    } catch {
      // 錯誤由 mutation 的 onError 顯示；編輯區與輸入保留，讓使用者修正後重送
      return;
    }
    setEditing(false);
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('role.detail.basic')}</h3>
        {canEdit && !editing && (
          <Button size="sm" onClick={() => startEditing(role)} data-testid="role-edit-button">
            {t('common.edit')}
          </Button>
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
          data-testid="role-edit-form"
        >
          {isVersionConflict(updateRole.error) && (
            <VersionConflictAlert
              error={updateRole.error}
              onReload={() => void reload()}
              reloading={reloading}
            />
          )}
          <Field label={t('role.field.name')} required>
            <Input
              value={name}
              maxLength={64}
              ref={nameRef}
              onChange={(event) => setName(event.target.value)}
              data-testid="role-name-edit-input"
            />
          </Field>
          <Field label={t('role.field.description')}>
            <Textarea
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={!name.trim()}
              loading={updateRole.isPending}
              data-testid="role-save-button"
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('role.field.description')}</dt>
          <dd className="m-0">{role.description || '-'}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('role.field.type')}</dt>
          <dd className="m-0">
            {role.isSystem ? (
              <Chip tone="brand">{t('role.type.system')}</Chip>
            ) : (
              <Chip tone="neutral">{t('role.type.custom')}</Chip>
            )}
          </dd>
        </dl>
      )}
    </section>
  );
}
