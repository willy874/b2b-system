import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input, Textarea } from '@b2b-system/ui/Input';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

import type { OrgUnitDetail } from '@/shared/api-sdk';

import { useOrgUnitCreateMutation } from '../../../hooks/useOrgUnitMutations';

/** 新增到哪裡：`parentId` 為 `null` 是最上層。 */
export interface OrgUnitCreateTarget {
  parentId: string | null;
  parentName?: string;
}

interface OrgUnitCreateDialogProps {
  /** `undefined` 時關閉。 */
  target: OrgUnitCreateTarget | undefined;
  onClose: () => void;
  onCreated: (unit: OrgUnitDetail) => void;
}

/** 新增部門（最上層或某個部門的下層）；排在同層最後（後端決定 `sortOrder`）。 */
export function OrgUnitCreateDialog({ target, onClose, onCreated }: OrgUnitCreateDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const createUnit = useOrgUnitCreateMutation();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [openedFor, setOpenedFor] = useState<OrgUnitCreateTarget>();
  // 每次開啟都是空白表單（render 期間調整 state，不經過 effect）
  if (target !== openedFor) {
    setOpenedFor(target);
    setName('');
    setCode('');
    setDescription('');
    createUnit.reset();
  }

  const submit = () => {
    if (!target || !name.trim()) return;
    createUnit.mutate(
      {
        params: {
          body: {
            name,
            parentId: target.parentId,
            code: code.trim() || null,
            description: description.trim() || null,
          },
        },
      },
      {
        onSuccess: (unit) => {
          onCreated(unit);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => !open && onClose()}
      title={t('organization.create.title')}
      description={
        target?.parentName
          ? t('organization.create.underParent', { name: target.parentName })
          : t('organization.create.topLevel')
      }
      size="sm"
      data-testid="org-unit-create-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            loading={createUnit.isPending}
            onClick={submit}
            data-testid="org-unit-create-submit"
          >
            {t('organization.create.submit')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {createUnit.isError && <FormError>{toMessage(createUnit.error)}</FormError>}
        <Field label={t('organization.field.name')} required>
          <Input
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            data-testid="org-unit-create-name"
          />
        </Field>
        <Field label={t('organization.field.code')} description={t('organization.field.codeHint')}>
          <Input
            value={code}
            maxLength={32}
            onChange={(event) => setCode(event.target.value)}
            data-testid="org-unit-create-code"
          />
        </Field>
        <Field label={t('organization.field.description')}>
          <Textarea
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
