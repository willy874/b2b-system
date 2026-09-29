import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getWorkspaceRoleListQueryOptions } from '@/apis/workspace/get-workspace-role-list/query';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Dialog } from '@/components/Dialog';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { WorkspaceMember } from '@/shared/api-sdk';

import { useUpdateWorkspaceMemberRolesMutation } from '../../../hooks/useWorkspaceMutations';

interface MemberRolesDialogProps {
  workspaceId: string;
  member: WorkspaceMember | undefined;
  onClose: () => void;
}

/** 勾選成員的工作區角色（整批取代）；反提權由後端判斷，錯誤顯示在對話框裡。 */
export function MemberRolesDialog({ workspaceId, member, onClose }: MemberRolesDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const roles = useQuery({
    ...getWorkspaceRoleListQueryOptions(workspaceId),
    enabled: Boolean(member),
  });
  const update = useUpdateWorkspaceMemberRolesMutation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [openedFor, setOpenedFor] = useState<WorkspaceMember>();
  // 每次開啟從目前的角色開始（render 期間調整 state，不經過 effect）
  if (member !== openedFor) {
    setOpenedFor(member);
    setSelected(new Set(member?.roles.map((role) => role.id) ?? []));
    setError(undefined);
  }

  const submit = async () => {
    if (!member) return;
    setError(undefined);
    try {
      await update.mutateAsync({
        params: { workspaceId, userId: member.id, roleIds: [...selected] },
      });
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <Dialog
      open={Boolean(member)}
      onOpenChange={(open) => !open && onClose()}
      title={t('workspace.member.editRoles.title', { name: member?.displayName ?? '' })}
      description={t('workspace.member.editRoles.description')}
      data-testid="workspace-member-roles-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={() => void submit()}
            data-testid="workspace-member-roles-submit"
          >
            {t('common.save')}
          </Button>
        </>
      }
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
            data-testid="workspace-member-role-checkbox"
          />
        ))}
        {error && <p className="m-0 text-sm text-[var(--color-danger-text)]">{error}</p>}
      </div>
    </Dialog>
  );
}
