import { useState } from 'react';

import type { FileGrantLevel } from '@/apis/file/types';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';

import {
  FILE_GRANT_LEVEL_HINT_KEY,
  FILE_GRANT_LEVEL_LABEL_KEY,
  FILE_GRANT_LEVELS,
} from '../../../constants';
import { useFileAccessRequestMutation } from '../../../hooks/useFolderGrantMutations';

interface FileAccessRequestDialogProps {
  /** 要申請的資料夾；`undefined` 時關閉。 */
  folder: { id: string; name: string } | undefined;
  onClose: () => void;
}

/**
 * 申請資料夾存取（docs/rbac/07-resource-grants.md §6.5）：選等級、填理由。
 * 送到資料夾的管理者與系統管理員；核准後自動取得申請的等級。
 */
export function FileAccessRequestDialog({ folder, onClose }: FileAccessRequestDialogProps) {
  const { t } = useTranslation();
  const request = useFileAccessRequestMutation();
  const [level, setLevel] = useState<FileGrantLevel>('viewer');
  const [reason, setReason] = useState('');
  const [openedFor, setOpenedFor] = useState(folder);
  // 每次開啟從頭填（render 期間調整 state，不經過 effect）
  if (folder !== openedFor) {
    setOpenedFor(folder);
    setLevel('viewer');
    setReason('');
  }

  const submit = () => {
    if (!folder) return;
    request.mutate(
      { params: { folderId: folder.id, body: { level, reason: reason.trim() || undefined } } },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open={Boolean(folder)}
      onOpenChange={(open) => !open && onClose()}
      title={t('file.access.requestTitle', { name: folder?.name ?? '' })}
      description={t('file.access.lockedDescription')}
      size="sm"
      data-testid="file-access-request-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={request.isPending}
            onClick={submit}
            data-testid="file-access-request-submit"
          >
            {t('file.access.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('file.access.level')}>
          <Select
            options={FILE_GRANT_LEVELS.map((value) => ({
              value,
              label: t(FILE_GRANT_LEVEL_LABEL_KEY[value]),
              description: t(FILE_GRANT_LEVEL_HINT_KEY[value]),
            }))}
            value={level}
            onValueChange={setLevel}
            data-testid="file-access-request-level"
          />
        </Field>
        <Field label={t('file.access.reason')}>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('file.access.reasonPlaceholder')}
            maxLength={500}
            data-testid="file-access-request-reason"
          />
        </Field>
      </div>
    </Dialog>
  );
}
