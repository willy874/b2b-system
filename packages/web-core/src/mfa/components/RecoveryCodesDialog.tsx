import { Button } from '@b2b-system/ui/Button';
import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Icon } from '@b2b-system/ui/Icon';
import { useState } from 'react';

import { useTranslation } from '../../locales';
import { useToast } from '../../notify';

export interface RecoveryCodesDialogProps {
  open: boolean;
  codes: readonly string[];
  /** 帳號的 email：下載的檔名與檔案內容用。 */
  account: string;
  /** 使用者勾了「我已保存」並按下完成。 */
  onDone: () => void;
  /** 完成鈕的文字（登入互動裡是「繼續登入」）。 */
  doneLabel?: string;
}

/**
 * 備用碼只出現這一次（docs/architecture/backend/21-mfa.md §11）：顯示、複製、下載 `.txt`；
 * 要勾「我已保存」才能關，Esc 與點遮罩都不關。
 */
export function RecoveryCodesDialog({
  open,
  codes,
  account,
  onDone,
  doneLabel,
}: RecoveryCodesDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('mfa.recovery.copied'));
    } catch {
      toast.error(t('mfa.recovery.copyFailed'));
    }
  };

  const download = () => {
    const content = `${t('mfa.recovery.fileHeader', { account })}\n\n${text}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `recovery-codes-${account}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open={open}
      dismissible={false}
      title={t('mfa.recovery.title')}
      description={t('mfa.recovery.description')}
      data-testid="mfa-recovery-dialog"
      footer={
        <Button
          variant="primary"
          disabled={!saved}
          onClick={() => {
            setSaved(false);
            onDone();
          }}
          data-testid="mfa-recovery-done"
        >
          {doneLabel ?? t('mfa.recovery.done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <ol
          className="m-0 grid grid-cols-2 gap-x-6 gap-y-1 rounded bg-[var(--color-fill-subtle)] p-3 font-mono text-sm"
          data-testid="mfa-recovery-codes"
        >
          {codes.map((code) => (
            <li key={code} className="list-none" data-testid="mfa-recovery-code" data-value={code}>
              {code}
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Button
            size="sm"
            startIcon={<Icon name="copy" size={14} />}
            onClick={() => void copy()}
            data-testid="mfa-recovery-copy"
          >
            {t('mfa.recovery.copy')}
          </Button>
          <Button
            size="sm"
            startIcon={<Icon name="download" size={14} />}
            onClick={download}
            data-testid="mfa-recovery-download"
          >
            {t('mfa.recovery.download')}
          </Button>
        </div>
        <Checkbox
          checked={saved}
          onCheckedChange={setSaved}
          label={t('mfa.recovery.confirmSaved')}
          data-testid="mfa-recovery-saved"
        />
      </div>
    </Dialog>
  );
}
