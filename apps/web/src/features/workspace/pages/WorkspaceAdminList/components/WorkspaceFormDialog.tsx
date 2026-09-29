import { useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { Workspace } from '@/shared/api-sdk';

import {
  useCreateWorkspaceMutation,
  useUpdateWorkspaceMutation,
} from '../../../hooks/useWorkspaceMutations';
import { UserPicker } from './UserPicker';

/** 與後端 `WORKSPACE_SLUG_PATTERN` 相同。 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

interface WorkspaceFormDialogProps {
  open: boolean;
  /** 有值是編輯（只能改名稱與說明），沒有是建立。 */
  workspace?: Workspace;
  onClose: () => void;
}

export function WorkspaceFormDialog({ open, workspace, onClose }: WorkspaceFormDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const create = useCreateWorkspaceMutation();
  const update = useUpdateWorkspaceMutation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();
  const [openedFor, setOpenedFor] = useState<{ open: boolean; workspace?: Workspace }>({
    open: false,
  });
  // 每次開啟從頭填（render 期間調整 state，不經過 effect）
  if (open !== openedFor.open || workspace !== openedFor.workspace) {
    setOpenedFor({ open, workspace });
    if (open) {
      setName(workspace?.name ?? '');
      setSlug('');
      setDescription(workspace?.description ?? '');
      setAdminUserId(null);
      setSubmitted(false);
      setError(undefined);
    }
  }

  const nameInvalid = submitted && !name.trim();
  const slugInvalid = submitted && Boolean(slug) && !SLUG_PATTERN.test(slug);
  const adminInvalid = submitted && !workspace && !adminUserId;

  const submit = async () => {
    setSubmitted(true);
    if (!name.trim() || (slug && !SLUG_PATTERN.test(slug)) || (!workspace && !adminUserId)) return;
    setError(undefined);
    try {
      if (workspace) {
        await update.mutateAsync({
          params: {
            workspaceId: workspace.id,
            body: { name: name.trim(), description: description.trim() || null },
          },
        });
      } else if (adminUserId) {
        await create.mutateAsync({
          params: {
            name: name.trim(),
            slug: slug || undefined,
            description: description.trim() || undefined,
            adminUserId,
          },
        });
      }
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={workspace ? t('workspace.admin.edit.title') : t('workspace.admin.create.title')}
      data-testid="workspace-form-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={create.isPending || update.isPending}
            onClick={() => void submit()}
            data-testid="workspace-form-submit"
          >
            {workspace ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label={t('workspace.admin.field.name')}
          required
          error={nameInvalid ? t('workspace.admin.error.nameRequired') : undefined}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            data-testid="workspace-name-input"
          />
        </Field>
        {!workspace && (
          <Field
            label={t('workspace.admin.field.slug')}
            description={t('workspace.admin.slugHint')}
            error={slugInvalid ? t('workspace.admin.error.slugInvalid') : undefined}
          >
            <Input
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
              maxLength={50}
              data-testid="workspace-slug-input"
            />
          </Field>
        )}
        <Field label={t('workspace.admin.field.description')}>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
          />
        </Field>
        {!workspace && (
          <Field
            label={t('workspace.admin.field.admin')}
            required
            error={adminInvalid ? t('workspace.admin.error.adminRequired') : undefined}
          >
            <UserPicker value={adminUserId} onChange={setAdminUserId} invalid={adminInvalid} />
          </Field>
        )}
        {error && <p className="m-0 text-sm text-[var(--color-danger-text)]">{error}</p>}
      </form>
    </Dialog>
  );
}
