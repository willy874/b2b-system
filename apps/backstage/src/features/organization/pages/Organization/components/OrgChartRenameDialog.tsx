import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

export interface OrgChartRenameTarget {
  id: string;
  name: string;
}

interface OrgChartRenameDialogProps {
  /** `undefined` 時關閉。 */
  target: OrgChartRenameTarget | undefined;
  onClose: () => void;
  /** 只改草稿，按組織圖的「儲存」才送出。 */
  onSubmit: (name: string) => void;
}

/** 組織圖編輯模式裡雙擊節點改名。 */
export function OrgChartRenameDialog({ target, onClose, onSubmit }: OrgChartRenameDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [openedFor, setOpenedFor] = useState<OrgChartRenameTarget>();
  // 每次開啟從目前的名稱開始（render 期間調整 state，不經過 effect）
  if (target !== openedFor) {
    setOpenedFor(target);
    setName(target?.name ?? '');
  }

  const submit = () => {
    if (name.trim()) onSubmit(name.trim());
  };

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => !open && onClose()}
      title={t('organization.chart.renameTitle')}
      size="sm"
      data-testid="org-chart-rename-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={submit}
            data-testid="org-chart-rename-submit"
          >
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={t('organization.field.name')} required>
          <Input
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            data-testid="org-chart-rename-input"
          />
        </Field>
      </form>
    </Dialog>
  );
}
