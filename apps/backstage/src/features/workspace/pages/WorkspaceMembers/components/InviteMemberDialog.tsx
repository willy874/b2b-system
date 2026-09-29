import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';

import { getWorkspaceRoleListQueryOptions } from '@/apis/workspace/get-workspace-role-list/query';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { useCreateWorkspaceInvitationMutation } from '../../../hooks/useWorkspaceMutations';

const EmailSchema = z.string().trim().email().max(255);

interface InviteMemberDialogProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * 以 email 邀請成員並指定工作區角色（docs/adr/0018-workspace-tenancy.md D14）。
 * 反提權與「沒有帳號的 email 需要平台的 user:create」由後端判斷，錯誤顯示在對話框裡。
 */
export function InviteMemberDialog({ workspaceId, open, onClose }: InviteMemberDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const roles = useQuery({ ...getWorkspaceRoleListQueryOptions(workspaceId), enabled: open });
  const invite = useCreateWorkspaceInvitationMutation();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [wasOpen, setWasOpen] = useState(open);
  // 每次開啟都從空白開始（render 期間調整 state，不經過 effect）
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEmail('');
      setEmailError(undefined);
      setSelected(new Set());
      setError(undefined);
    }
  }

  const submit = async () => {
    setError(undefined);
    const parsed = EmailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError(t('workspace.invitation.field.emailInvalid'));
      return;
    }
    setEmailError(undefined);
    try {
      await invite.mutateAsync({
        params: { workspaceId, email: parsed.data, roleIds: [...selected] },
      });
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('workspace.invitation.create.title')}
      description={t('workspace.invitation.create.description')}
      data-testid="workspace-invite-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={invite.isPending}
            onClick={() => void submit()}
            data-testid="workspace-invite-submit"
          >
            {t('workspace.invitation.create.submit')}
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
        <Field label={t('workspace.invitation.field.email')} required error={emailError}>
          <Input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="workspace-invite-email"
          />
        </Field>
        <Field
          label={t('workspace.invitation.field.roles')}
          description={t('workspace.member.editRoles.description')}
        >
          <div className="flex flex-col gap-3">
            {(roles.data?.items ?? []).map((role) => (
              <Checkbox
                key={role.id}
                checked={selected.has(role.id)}
                onCheckedChange={(checked) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(role.id);
                    else next.delete(role.id);
                    return next;
                  })
                }
                label={role.name}
                description={role.description ?? undefined}
                data-testid="workspace-invite-role-checkbox"
                data-value={role.slug}
              />
            ))}
          </div>
        </Field>
        {error && <p className="m-0 text-sm text-[var(--color-danger-text)]">{error}</p>}
      </form>
    </Dialog>
  );
}
