import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import {
  useFolderCreateMutation,
  useFolderRenameMutation,
} from '../../../hooks/useFolderMutations';

/** 建立（在 `parentId` 底下）或改名（`folder`）。 */
export type FolderDialogTarget =
  | { mode: 'create'; parentId: string | undefined }
  | { mode: 'rename'; folder: { id: string; name: string } };

interface FileFolderDialogProps {
  /** `undefined` 時關閉。 */
  target: FolderDialogTarget | undefined;
  onClose: () => void;
  /** 建立成功後（例：選取新資料夾）。 */
  onCreated?: (folderId: string) => void;
}

/** 資料夾的名稱對話框。同層同名（`FILE_FOLDER_NAME_CONFLICT`）時顯示錯誤並保留輸入。 */
export function FileFolderDialog({ target, onClose, onCreated }: FileFolderDialogProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const create = useFolderCreateMutation();
  const rename = useFolderRenameMutation();
  const mutation = target?.mode === 'rename' ? rename : create;
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const initialName = target?.mode === 'rename' ? target.folder.name : '';
  const targetKey =
    target && (target.mode === 'rename' ? target.folder.id : `new:${target.parentId}`);

  useEffect(() => {
    if (!targetKey) return;
    setName(initialName);
    create.reset();
    rename.reset();
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    // 只在換目標時重設，不覆寫使用者正在輸入的內容
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 見上
  }, [targetKey]);

  const trimmed = name.trim();
  const submit = async () => {
    if (!target || !trimmed) return;
    if (target.mode === 'rename') {
      if (trimmed === target.folder.name) {
        onClose();
        return;
      }
      await rename
        .mutateAsync({ params: { folderId: target.folder.id, body: { name: trimmed } } })
        .then(onClose)
        .catch(() => undefined);
      return;
    }
    await create
      .mutateAsync({ params: { name: trimmed, parentId: target.parentId ?? null } })
      .then((folder) => {
        onClose();
        onCreated?.(folder.id);
      })
      .catch(() => undefined);
  };

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => !open && onClose()}
      title={target?.mode === 'rename' ? t('file.rename.title') : t('file.folder.create.title')}
      size="sm"
      data-testid="file-folder-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!trimmed}
            onClick={() => void submit()}
            data-testid="file-folder-dialog-submit"
          >
            {target?.mode === 'rename' ? t('common.save') : t('file.folder.create.submit')}
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
          placeholder={t('file.folder.create.placeholder')}
          aria-label={t('file.folder.name')}
          maxLength={255}
          invalid={Boolean(mutation.error)}
          data-testid="file-folder-dialog-input"
        />
        {mutation.error && (
          <p className="m-0 text-xs text-[var(--color-danger-text)]" role="alert">
            {errorMessage(mutation.error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
