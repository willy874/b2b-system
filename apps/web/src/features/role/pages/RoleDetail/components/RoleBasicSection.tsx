import { useState } from 'react';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { useTranslation } from '@/core/locales';
import type { Role } from '@/shared/api-sdk';

import { useRoleUpdateMutation } from '../../../hooks/useRoleMutations';

interface RoleBasicSectionProps {
  role: Role;
  /** 有 role:update 且不是系統角色 */
  canEdit: boolean;
}

/** 角色基本資料：檢視 ／ 就地編輯名稱與描述。 */
export function RoleBasicSection({ role, canEdit }: RoleBasicSectionProps) {
  const { t } = useTranslation();
  const updateRole = useRoleUpdateMutation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('role.detail.basic')}</h3>
        {canEdit && !editing && (
          <Button
            size="sm"
            onClick={() => {
              setName(role.name);
              setDescription(role.description ?? '');
              setEditing(true);
            }}
            data-testid="role-edit-button"
          >
            {t('common.edit')}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-2 flex flex-col gap-3">
          <Field label={t('role.field.name')} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('role.field.description')}>
            <Textarea
              value={description}
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
              loading={updateRole.isPending}
              onClick={async () => {
                await updateRole
                  .mutateAsync({ params: { roleId: role.id, body: { name, description } } })
                  .catch(() => undefined);
                setEditing(false);
              }}
              data-testid="role-save-button"
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
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
