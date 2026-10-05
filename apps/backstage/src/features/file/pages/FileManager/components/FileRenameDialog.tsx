import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Input } from '@b2b-system/ui/Input';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useEffect, useRef, useState } from 'react';

import { useFileRenameMutation } from '../../../hooks/useFileMutations';
import type { FileItemVM } from '../adapter';

interface FileRenameDialogProps {
  /** 要改名的檔案；`undefined` 時關閉。畫面上的資料更新時（別人改了名）版本號跟著更新。 */
  file: FileItemVM | undefined;
  onClose: () => void;
}

/**
 * 改名。送出時帶上看到的 `version`：別人搶先改過時顯示衝突訊息並保留輸入，
 * 資料重抓後（`useFileRenameMutation` 會失效該檔案）版本號更新，使用者確認後可以再送一次。
 */
export function FileRenameDialog({ file, onClose }: FileRenameDialogProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const rename = useFileRenameMutation();
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const fileId = file?.id;

  useEffect(() => {
    if (!fileId) return;
    setName(file.name);
    rename.reset();
    // 開啟時聚焦並選取主檔名（不含副檔名），直接打字就能改
    requestAnimationFrame(() => {
      const dot = file.name.lastIndexOf('.');
      input.current?.focus();
      input.current?.setSelectionRange(0, dot > 0 ? dot : file.name.length);
    });
    // 只在換檔案時重設；file.name 的更新（別人改名）不覆寫使用者正在輸入的內容
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 見上
  }, [fileId]);

  const trimmed = name.trim();
  const submit = async () => {
    if (!file || !trimmed || trimmed === file.name) {
      onClose();
      return;
    }
    await rename
      .mutateAsync({ params: { fileId: file.id, body: { name: trimmed, version: file.version } } })
      .then(onClose)
      .catch(() => undefined);
  };

  return (
    <Dialog
      open={Boolean(file)}
      onOpenChange={(open) => !open && onClose()}
      title={t('file.rename.title')}
      size="sm"
      data-testid="file-rename-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={rename.isPending}
            disabled={!trimmed}
            onClick={() => void submit()}
            data-testid="file-rename-submit"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          ref={input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={t('file.field.name')}
          maxLength={255}
          invalid={Boolean(rename.error)}
          data-testid="file-rename-input"
        />
        {rename.error && (
          <p className="m-0 text-xs text-[var(--color-danger-text)]" role="alert">
            {errorMessage(rename.error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
