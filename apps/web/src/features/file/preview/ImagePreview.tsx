import { useState } from 'react';

import { IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import type { FilePreviewerProps } from '@/core/file';
import { useTranslation } from '@/core/locales';
import { cn } from '@/shared/utils';

/** 透明底用棋盤格顯示：遊戲素材常有透明區域，純色背景看不出邊界。顏色取自 token。 */
const CHECKERBOARD = {
  backgroundColor: 'var(--color-surface)',
  backgroundImage:
    'linear-gradient(45deg, var(--color-fill) 25%, transparent 25%), linear-gradient(-45deg, var(--color-fill) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-fill) 75%), linear-gradient(-45deg, transparent 75%, var(--color-fill) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
};

/** 圖片預覽：預設縮放到可視範圍內，可切換成原始大小（可捲動）。 */
export function ImagePreview({ file }: FilePreviewerProps) {
  const { t } = useTranslation();
  const [actualSize, setActualSize] = useState(false);
  const [broken, setBroken] = useState(false);

  if (!file.url || broken) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-fg-muted)]"
        data-testid="file-preview-image-error"
      >
        <Icon name="warning" size={24} />
        <span className="text-sm">{t('file.preview.imageError')}</span>
      </div>
    );
  }

  return (
    <div className="relative h-full" data-testid="file-preview-image">
      <div
        className={cn(
          'h-full w-full overflow-auto rounded',
          !actualSize && 'flex items-center justify-center',
        )}
        style={CHECKERBOARD}
      >
        <img
          src={file.url}
          alt={file.name}
          decoding="async"
          onError={() => setBroken(true)}
          className={cn(actualSize ? 'max-w-none' : 'max-h-full max-w-full object-contain')}
        />
      </div>
      <IconButton
        size="sm"
        variant="secondary"
        className="absolute right-2 bottom-2"
        aria-label={actualSize ? t('file.preview.fit') : t('file.preview.actualSize')}
        aria-pressed={actualSize}
        onClick={() => setActualSize((value) => !value)}
        data-testid="file-preview-zoom"
      >
        <Icon name={actualSize ? 'zoom-out' : 'zoom-in'} size={16} />
      </IconButton>
    </div>
  );
}
