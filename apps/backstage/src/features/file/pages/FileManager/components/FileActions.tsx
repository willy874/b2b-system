import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useRef } from 'react';

import { collectFromFileList } from '../../../upload/collectEntries';
import type { CollectedUpload } from '../../../upload/collectEntries';

interface FileActionsProps {
  canUpload: boolean;
  onUpload: (upload: CollectedUpload) => void;
  canCreateFolder: boolean;
  onCreateFolder: () => void;
  /** 目前所在的資料夾能管理授權時顯示「共用此資料夾」。 */
  canShare: boolean;
  onShare: () => void;
}

/** 頁首右側、對目前資料夾的動作：共用此資料夾、新增資料夾、上傳（檔案或資料夾）。 */
export function FileActions({
  canUpload,
  onUpload,
  canCreateFolder,
  onCreateFolder,
  canShare,
  onShare,
}: FileActionsProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="file-actions">
      {canShare && (
        <Button
          startIcon={<Icon name="users" size={16} />}
          onClick={onShare}
          data-testid="file-share-button"
        >
          {t('file.share.openCurrent')}
        </Button>
      )}
      {canCreateFolder && (
        <Button
          startIcon={<Icon name="folder-plus" size={16} />}
          onClick={onCreateFolder}
          data-testid="file-create-folder-button"
        >
          {t('file.folder.create.action')}
        </Button>
      )}
      {canUpload && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const upload = collectFromFileList(Array.from(event.target.files ?? []));
              // 清空才能再次選同一個檔案
              event.target.value = '';
              if (upload.entries.length > 0) onUpload(upload);
            }}
            data-testid="file-upload-input"
          />
          <input
            // webkitdirectory 不在 React 的屬性型別裡（非標準但各大瀏覽器都支援）；以 ref 設定
            ref={(element) => {
              directoryInput.current = element;
              element?.setAttribute('webkitdirectory', '');
            }}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const upload = collectFromFileList(Array.from(event.target.files ?? []));
              event.target.value = '';
              if (upload.entries.length > 0 || upload.directories.length > 0) onUpload(upload);
            }}
            data-testid="file-upload-directory-input"
          />
          <Menu
            align="end"
            trigger={
              <Button
                variant="primary"
                startIcon={<Icon name="upload" size={16} />}
                endIcon={<Icon name="chevron-down" size={14} />}
                data-testid="file-upload-button"
              >
                {t('file.upload.action')}
              </Button>
            }
            items={[
              {
                key: 'files',
                textValue: t('file.upload.files'),
                label: (
                  <span className="flex items-center gap-2">
                    <Icon name="file" size={14} />
                    {t('file.upload.files')}
                  </span>
                ),
                onSelect: () => input.current?.click(),
              },
              {
                key: 'directory',
                textValue: t('file.upload.directory'),
                label: (
                  <span className="flex items-center gap-2">
                    <Icon name="folder-upload" size={14} />
                    {t('file.upload.directory')}
                  </span>
                ),
                onSelect: () => directoryInput.current?.click(),
              },
            ]}
            data-testid="file-upload-menu"
          />
        </>
      )}
    </div>
  );
}
