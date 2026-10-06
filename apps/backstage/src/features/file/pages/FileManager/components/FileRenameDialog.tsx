import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Input } from '@b2b-system/ui/Input';
import { useErrorMessage, useErrorToast, isVersionConflict } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { getFileDetailQueryOptions } from '@/apis/file/get-file-detail/query';
import { VersionConflictAlert } from '@/core/components';

import { useFileRenameMutation } from '../../../hooks/useFileMutations';
import type { FileItemVM } from '../adapter';

interface FileRenameDialogProps {
  /** 要改名的檔案；`undefined` 時關閉。開啟中資料被重抓（別人改了名）不影響這次編輯所依據的版本。 */
  file: FileItemVM | undefined;
  onClose: () => void;
}

/**
 * 改名。開啟時記下當時的 `version`，送出時帶它：編輯途中推播讓列表重抓，也不換成最新的版本，
 * 否則等於默默蓋掉別人的改名（docs/architecture/backend/03-api-conventions.md §11）。
 * 別人搶先改過時以 `VersionConflictAlert` 說明並保留輸入；按「重新載入」才換成最新的名稱與版本。
 */
export function FileRenameDialog({ file, onClose }: FileRenameDialogProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const rename = useFileRenameMutation();
  const [name, setName] = useState('');
  /** 這次編輯所依據的名稱與版本：開啟時的 `file`，衝突後按「重新載入」才更新。 */
  const [base, setBase] = useState({ name: '', version: 0 });
  const [reloading, setReloading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fileId = file?.id;

  useEffect(() => {
    if (!fileId) return;
    setName(file.name);
    setBase({ name: file.name, version: file.version });
    rename.reset();
    // 開啟時聚焦並選取主檔名（不含副檔名），直接打字就能改
    requestAnimationFrame(() => {
      const dot = file.name.lastIndexOf('.');
      input.current?.focus();
      input.current?.setSelectionRange(0, dot > 0 ? dot : file.name.length);
    });
    // 只在換檔案時重設；file 的更新（別人改名）不覆寫使用者正在輸入的內容與所依據的版本
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 見上
  }, [fileId]);

  /** 衝突後放棄這次的修改：重抓最新的名稱與版本，輸入改成以它為基礎。 */
  const reload = async () => {
    if (!fileId) return;
    setReloading(true);
    try {
      const latest = await queryClient.fetchQuery({
        ...getFileDetailQueryOptions(fileId),
        staleTime: 0,
      });
      setName(latest.name);
      setBase({ name: latest.name, version: latest.version });
      rename.reset();
    } catch (error) {
      showError(error);
    } finally {
      setReloading(false);
    }
  };

  const trimmed = name.trim();
  const submit = async () => {
    if (!file || !trimmed || trimmed === base.name) {
      onClose();
      return;
    }
    await rename
      .mutateAsync({ params: { fileId: file.id, body: { name: trimmed, version: base.version } } })
      .then(onClose)
      .catch(() => undefined);
  };
  const conflict = isVersionConflict(rename.error);

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
        {conflict && (
          <VersionConflictAlert
            error={rename.error}
            onReload={() => void reload()}
            reloading={reloading}
          />
        )}
        {rename.error && !conflict && (
          <p className="m-0 text-xs text-[var(--color-danger-text)]" role="alert">
            {errorMessage(rename.error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
