import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { useId, useRef } from 'react';

import { useTranslation } from '../locales';
import type { ImageUsage } from './types';

interface UploadSourceProps {
  usage: ImageUsage;
  onFiles: (files: readonly File[]) => void;
}

/**
 * 內建的來源「上傳」（docs/architecture/frontend/23-image-picker.md §4）：選檔；拖曳與貼上由對話框處理，
 * 拖進對話框的任何一個分頁都會切到這裡。
 */
export function UploadSource({ usage, onFiles }: UploadSourceProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--color-border)] px-4 py-10 text-center"
      data-testid="image-picker-upload"
    >
      <Icon name="upload" size={24} />
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('imagePicker.upload.hint')}</p>
      <Button variant="primary" onClick={() => inputRef.current?.click()}>
        {t('imagePicker.upload.browse')}
      </Button>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">
        {t('imagePicker.upload.limits', {
          max: Math.floor(usage.maxSize / 1024 / 1024),
          width: usage.minWidth,
          height: usage.minHeight,
        })}
      </p>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        hidden
        accept={usage.contentTypes.join(',')}
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
        data-testid="image-picker-upload-input"
      />
    </div>
  );
}
