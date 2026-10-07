import { Button } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { Separator } from '@b2b-system/ui/Separator';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useDialogUnsavedGuard } from '@b2b-system/web-core/router';
import { useState } from 'react';

import type { PlatformAdmin, UpdatePlatformAdminRequest } from '@/shared/api-sdk';

import {
  EDITABLE_PLATFORM_ADMIN_STATUSES,
  PLATFORM_ADMIN_ROLE_LABEL_KEY,
  PLATFORM_ADMIN_ROLES,
  PLATFORM_ADMIN_STATUS_LABEL_KEY,
} from '../../../constants';
import type { EditablePlatformAdminStatus } from '../../../constants';
import { useUpdatePlatformAdminMutation } from '../../../hooks/usePlatformAdminMutations';
import { PlatformAdminMfaSection } from './PlatformAdminMfaSection';

/** 編輯需要的欄位（列表的 VM 與 DTO 都符合）。 */
type EditablePlatformAdmin = Pick<
  PlatformAdmin,
  'id' | 'email' | 'displayName' | 'role' | 'status'
>;

interface EditPlatformAdminDialogProps {
  admin: EditablePlatformAdmin;
  /** 自己：後端不允許變更自己的角色與狀態（`AUTHZ_SELF_MODIFY`），只能改名稱。 */
  isSelf: boolean;
  onClose: () => void;
}

function initialStatus(status: PlatformAdmin['status']): EditablePlatformAdminStatus | null {
  return status === 'active' || status === 'inactive' ? status : null;
}

/**
 * 編輯平台管理者：名稱、角色、狀態（啟用／停用）。只送出有改的欄位。
 * 待啟用的不能改狀態（後端回 `VALIDATION_FAILED`）；鎖定的改成「啟用」即解鎖。
 * 由呼叫端在要編輯時才掛上（以 `key` 區分對象），所以 state 直接從 `admin` 初始化。
 */
export function EditPlatformAdminDialog({ admin, isSelf, onClose }: EditPlatformAdminDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const confirm = useConfirm();
  const update = useUpdatePlatformAdminMutation();
  const [displayName, setDisplayName] = useState(admin.displayName);
  const [role, setRole] = useState(admin.role);
  const [status, setStatus] = useState(initialStatus(admin.status));
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();

  const canEditRole = !isSelf;
  const canEditStatus = !isSelf && admin.status !== 'pending';
  const nameInvalid = !displayName.trim();
  // 掛上時就是開著的：有改動時 Esc、點遮罩、取消與換頁都先確認；儲存成功直接關閉
  const guard = useDialogUnsavedGuard(
    displayName !== admin.displayName ||
      role !== admin.role ||
      status !== initialStatus(admin.status),
    onClose,
  );

  const submit = async () => {
    setSubmitted(true);
    if (nameInvalid) return;
    const body: UpdatePlatformAdminRequest = {};
    if (displayName.trim() !== admin.displayName) body.displayName = displayName.trim();
    if (canEditRole && role !== admin.role) body.role = role;
    if (canEditStatus && status && status !== admin.status) body.status = status;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    // 停用會撤銷對方所有 session 並立即登出、降級會立即拿走權限：與 backstage 停用使用者一樣先說清楚
    // （PLATFORM_ADMIN_ROLES 由大到小排列）
    const deactivating = body.status === 'inactive';
    const downgrading =
      body.role !== undefined &&
      PLATFORM_ADMIN_ROLES.indexOf(body.role) > PLATFORM_ADMIN_ROLES.indexOf(admin.role);
    if (deactivating || downgrading) {
      const confirmed = await confirm(
        deactivating
          ? {
              title: t('platformAdmin.deactivate.title'),
              description: t('platformAdmin.deactivate.confirm', { name: admin.displayName }),
              confirmLabel: t('platformAdmin.deactivate.action'),
              tone: 'danger',
              'data-testid': 'platform-admin-deactivate-confirm',
            }
          : {
              title: t('platformAdmin.downgrade.title'),
              description: t('platformAdmin.downgrade.confirm', {
                name: admin.displayName,
                from: t(PLATFORM_ADMIN_ROLE_LABEL_KEY[admin.role]),
                to: t(PLATFORM_ADMIN_ROLE_LABEL_KEY[role]),
              }),
              confirmLabel: t('platformAdmin.downgrade.action'),
              tone: 'danger',
              'data-testid': 'platform-admin-downgrade-confirm',
            },
      );
      if (!confirmed) return;
    }
    setError(undefined);
    try {
      await update.mutateAsync({ params: { id: admin.id, body } });
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={guard.onOpenChange}
      title={t('platformAdmin.edit.title')}
      description={admin.email}
      data-testid="platform-admin-edit-dialog"
      footer={
        <>
          <Button onClick={guard.requestClose} data-testid="platform-admin-edit-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={() => void submit()}
            data-testid="platform-admin-edit-submit"
          >
            {t('common.save')}
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
          label={t('platformAdmin.field.displayName')}
          required
          error={
            submitted && nameInvalid ? t('platformAdmin.error.displayNameRequired') : undefined
          }
        >
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={100}
            data-testid="platform-admin-edit-display-name-input"
          />
        </Field>
        {canEditRole && (
          <Field label={t('platformAdmin.field.role')} required>
            <Select
              value={role}
              onValueChange={setRole}
              options={PLATFORM_ADMIN_ROLES.map((value) => ({
                value,
                label: t(PLATFORM_ADMIN_ROLE_LABEL_KEY[value]),
              }))}
              data-testid="platform-admin-edit-role-select"
            />
          </Field>
        )}
        {canEditStatus && (
          <Field
            label={t('platformAdmin.field.status')}
            description={admin.status === 'locked' ? t('platformAdmin.hint.locked') : undefined}
          >
            <Select
              value={status}
              onValueChange={setStatus}
              placeholder={t(PLATFORM_ADMIN_STATUS_LABEL_KEY[admin.status])}
              options={EDITABLE_PLATFORM_ADMIN_STATUSES.map((value) => ({
                value,
                label: t(PLATFORM_ADMIN_STATUS_LABEL_KEY[value]),
              }))}
              data-testid="platform-admin-edit-status-select"
            />
          </Field>
        )}
        {isSelf && (
          <p
            className="m-0 text-sm text-[var(--color-fg-muted)]"
            data-testid="platform-admin-edit-self-hint"
          >
            {t('platformAdmin.hint.self')}
          </p>
        )}
        {!isSelf && admin.status === 'pending' && (
          <p
            className="m-0 text-sm text-[var(--color-fg-muted)]"
            data-testid="platform-admin-edit-pending-hint"
          >
            {t('platformAdmin.hint.pending')}
          </p>
        )}
        <FormError data-testid="platform-admin-edit-error">{error}</FormError>
      </form>
      <Separator className="my-4" />
      <PlatformAdminMfaSection adminId={admin.id} isSelf={isSelf} />
    </Dialog>
  );
}
