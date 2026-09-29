import { useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { Workspace } from '@/shared/api-sdk';

import { useAssignWorkspaceAdminMutation } from '../../../hooks/useWorkspaceMutations';
import { UserPicker } from './UserPicker';

interface AssignAdminDialogProps {
  workspace?: Workspace;
  onClose: () => void;
}

/** 指定管理員（docs/adr/0018-workspace-tenancy.md D12）：加入成員並給 workspace-admin。 */
export function AssignAdminDialog({ workspace, onClose }: AssignAdminDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const assign = useAssignWorkspaceAdminMutation();
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [openedFor, setOpenedFor] = useState<Workspace>();
  // 每次開啟從頭選（render 期間調整 state，不經過 effect）
  if (workspace !== openedFor) {
    setOpenedFor(workspace);
    setUserId(null);
    setError(undefined);
  }

  const submit = async () => {
    if (!workspace || !userId) return;
    try {
      await assign.mutateAsync({ params: { workspaceId: workspace.id, userId } });
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <Dialog
      open={Boolean(workspace)}
      onOpenChange={(open) => !open && onClose()}
      title={t('workspace.admin.assignAdmin.title', { name: workspace?.name ?? '' })}
      description={t('workspace.admin.assignAdmin.description')}
      data-testid="workspace-assign-admin-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!userId}
            loading={assign.isPending}
            onClick={() => void submit()}
            data-testid="workspace-assign-admin-submit"
          >
            {t('workspace.admin.assignAdmin.action')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <UserPicker value={userId} onChange={setUserId} />
        {error && <p className="m-0 text-sm text-[var(--color-danger-text)]">{error}</p>}
      </div>
    </Dialog>
  );
}
