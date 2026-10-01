import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { getGroupDetailQueryOptions } from '@/apis/group/get-group-detail/query';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { VersionConflictAlert } from '@/core/components';
import { isVersionConflict, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useUnsavedChangesGuard } from '@/core/router';
import type { Group } from '@/shared/api-sdk';

import { useGroupUpdateMutation } from '../../../hooks/useGroupMutations';

interface GroupBasicSectionProps {
  group: Group;
  canEdit: boolean;
}

/**
 * 群組基本資料：檢視 ／ 就地編輯名稱與說明。送出時帶「開始編輯時」的 `version`（樂觀鎖，
 * docs/architecture/backend/03-api-conventions.md §11），與角色的基本資料相同。
 */
export function GroupBasicSection({ group, canEdit }: GroupBasicSectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  const updateGroup = useGroupUpdateMutation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseVersion, setBaseVersion] = useState(group.version);
  const [reloading, setReloading] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useUnsavedChangesGuard(
    editing && (name !== group.name || description !== (group.description ?? '')),
  );

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  const startEditing = (source: Group) => {
    setName(source.name);
    setDescription(source.description ?? '');
    setBaseVersion(source.version);
    updateGroup.reset();
    setEditing(true);
  };

  /** 衝突後放棄這次的修改：重抓最新的內容與版本，表單改成以它為基礎。 */
  const reload = async () => {
    setReloading(true);
    try {
      startEditing(
        await queryClient.fetchQuery({ ...getGroupDetailQueryOptions(group.id), staleTime: 0 }),
      );
    } catch (error) {
      showError(error);
    } finally {
      setReloading(false);
    }
  };

  const save = async () => {
    try {
      await updateGroup.mutateAsync({
        params: { groupId: group.id, body: { name, description, version: baseVersion } },
      });
    } catch {
      // 錯誤由 mutation 的 onError 顯示；輸入保留，讓使用者修正後重送
      return;
    }
    setEditing(false);
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('group.detail.basic')}</h3>
        {canEdit && !editing && (
          <Button size="sm" onClick={() => startEditing(group)} data-testid="group-edit-button">
            {t('common.edit')}
          </Button>
        )}
      </div>

      {editing ? (
        <form
          className="mt-2 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          data-testid="group-edit-form"
        >
          {isVersionConflict(updateGroup.error) && (
            <VersionConflictAlert
              error={updateGroup.error}
              onReload={() => void reload()}
              reloading={reloading}
            />
          )}
          <Field label={t('group.field.name')} required>
            <Input
              value={name}
              maxLength={64}
              ref={nameRef}
              onChange={(event) => setName(event.target.value)}
              data-testid="group-name-edit-input"
            />
          </Field>
          <Field label={t('group.field.description')}>
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
              loading={updateGroup.isPending}
              data-testid="group-save-button"
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('group.field.description')}</dt>
          <dd className="m-0">{group.description || '-'}</dd>
        </dl>
      )}
    </section>
  );
}
