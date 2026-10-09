import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import { useImageUsage, useMultiImageSourcesAvailable } from '@b2b-system/web-core/image-picker';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useRef } from 'react';

import { collectFromFileList } from '@/core/upload';
import type { CollectedUpload } from '@/core/upload';

import { GALLERY_IMAGE_USAGE } from '../../../constants';
import { GALLERY_IMAGE_SOURCE_ID } from '../../../imageSource/register';

interface GalleryAddMenuProps {
  onUpload: (upload: CollectedUpload) => void;
  onAddFromSources: () => void;
}

const EXCLUDED_SOURCES = [GALLERY_IMAGE_SOURCE_ID];

/**
 * 「加入」選單（docs/architecture/frontend/24-gallery.md §4、§6）：上傳圖片、上傳資料夾（只取裡面的圖片），
 * 以及「從其他來源…」——其他來源（檔案管理）沒啟用或沒有權限時不出現。
 */
export function GalleryAddMenu({ onUpload, onAddFromSources }: GalleryAddMenuProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const usage = useImageUsage(GALLERY_IMAGE_USAGE);
  const hasOtherSources = useMultiImageSourcesAvailable(usage, EXCLUDED_SOURCES) === true;
  const pick = (files: FileList | null) => {
    const upload = collectFromFileList(Array.from(files ?? []));
    if (upload.entries.length > 0) onUpload(upload);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept="image/*"
        onChange={(event) => {
          pick(event.target.files);
          // 清空才能再次選同一個檔案
          event.target.value = '';
        }}
        data-testid="gallery-upload-input"
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
          pick(event.target.files);
          event.target.value = '';
        }}
        data-testid="gallery-upload-directory-input"
      />
      <Menu
        align="end"
        trigger={
          <Button
            variant="primary"
            startIcon={<Icon name="plus" size={16} />}
            endIcon={<Icon name="chevron-down" size={14} />}
            data-testid="gallery-add-button"
          >
            {t('gallery.add.action')}
          </Button>
        }
        items={[
          {
            key: 'files',
            textValue: t('gallery.add.upload'),
            label: (
              <span className="flex items-center gap-2">
                <Icon name="upload" size={14} />
                {t('gallery.add.upload')}
              </span>
            ),
            onSelect: () => input.current?.click(),
          },
          {
            key: 'directory',
            textValue: t('gallery.add.directory'),
            label: (
              <span className="flex items-center gap-2">
                <Icon name="folder-upload" size={14} />
                {t('gallery.add.directory')}
              </span>
            ),
            onSelect: () => directoryInput.current?.click(),
          },
          ...(hasOtherSources
            ? [
                {
                  key: 'sources',
                  textValue: t('gallery.add.fromSource'),
                  label: (
                    <span className="flex items-center gap-2">
                      <Icon name="folder" size={14} />
                      {t('gallery.add.fromSource')}
                    </span>
                  ),
                  onSelect: onAddFromSources,
                },
              ]
            : []),
        ]}
        data-testid="gallery-add-menu"
      />
    </>
  );
}
