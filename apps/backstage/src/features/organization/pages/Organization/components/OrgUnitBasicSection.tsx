import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { Input, Textarea } from '@b2b-system/ui/Input';
import { isVersionConflict, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { getOrgUnitDetailQueryOptions } from '@/apis/org-unit/get-org-unit-detail/query';
import { VersionConflictAlert } from '@/core/components';
import type { OrgUnitDetail } from '@/shared/api-sdk';

import { useOrgUnitUpdateMutation } from '../../../hooks/useOrgUnitMutations';

interface OrgUnitBasicSectionProps {
  unit: OrgUnitDetail;
  canEdit: boolean;
}

/**
 * 部門基本資料：檢視 ／ 就地編輯名稱、代碼與說明。送出時帶「開始編輯時」的 `version`（樂觀鎖，
 * docs/architecture/backend/03-api-conventions.md §11），與群組的基本資料相同。
 */
export function OrgUnitBasicSection({ unit, canEdit }: OrgUnitBasicSectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  const updateUnit = useOrgUnitUpdateMutation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [baseVersion, setBaseVersion] = useState(unit.version);
  const [reloading, setReloading] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useUnsavedChangesGuard(
    editing &&
      (name !== unit.name ||
        code !== (unit.code ?? '') ||
        description !== (unit.description ?? '')),
  );

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  const startEditing = (source: OrgUnitDetail) => {
    setName(source.name);
    setCode(source.code ?? '');
    setDescription(source.description ?? '');
    setBaseVersion(source.version);
    updateUnit.reset();
    setEditing(true);
  };

  /** 衝突後放棄這次的修改：重抓最新的內容與版本，表單改成以它為基礎。 */
  const reload = async () => {
    setReloading(true);
    try {
      startEditing(
        await queryClient.fetchQuery({ ...getOrgUnitDetailQueryOptions(unit.id), staleTime: 0 }),
      );
    } catch (error) {
      showError(error);
    } finally {
      setReloading(false);
    }
  };

  const save = async () => {
    try {
      await updateUnit.mutateAsync({
        params: {
          unitId: unit.id,
          body: {
            name,
            // 清空＝拿掉代碼與說明
            code: code.trim() || null,
            description: description.trim() || null,
            version: baseVersion,
          },
        },
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
        <h3 className="m-0 text-sm font-semibold">{t('organization.detail.basic')}</h3>
        {canEdit && !editing && (
          <Button size="sm" onClick={() => startEditing(unit)} data-testid="org-unit-edit-button">
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
          data-testid="org-unit-edit-form"
        >
          {isVersionConflict(updateUnit.error) && (
            <VersionConflictAlert
              error={updateUnit.error}
              onReload={() => void reload()}
              reloading={reloading}
            />
          )}
          <Field label={t('organization.field.name')} required>
            <Input
              value={name}
              maxLength={64}
              ref={nameRef}
              onChange={(event) => setName(event.target.value)}
              data-testid="org-unit-name-edit-input"
            />
          </Field>
          <Field
            label={t('organization.field.code')}
            description={t('organization.field.codeHint')}
          >
            <Input
              value={code}
              maxLength={32}
              onChange={(event) => setCode(event.target.value)}
              data-testid="org-unit-code-edit-input"
            />
          </Field>
          <Field label={t('organization.field.description')}>
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
              loading={updateUnit.isPending}
              data-testid="org-unit-save-button"
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('organization.field.code')}</dt>
          <dd className="m-0" data-testid="org-unit-code">
            {unit.code || '-'}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('organization.field.description')}</dt>
          <dd className="m-0">{unit.description || '-'}</dd>
        </dl>
      )}
    </section>
  );
}
