import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { FormError } from '@b2b-system/ui/FormError';
import { centeredCrop, ImageCropper } from '@b2b-system/ui/ImageCropper';
import type { ImageCrop } from '@b2b-system/ui/ImageCropper';
import { Progress } from '@b2b-system/ui/Progress';
import { useState } from 'react';

import { useTranslation } from '../locales';
import type { ImageUsage } from './types';
import type { CropPreview } from './useImagePicker';

interface ImageCropDialogProps {
  usage: ImageUsage;
  preview: CropPreview;
  initialCrop?: ImageCrop;
  shape: 'circle' | 'square';
  isSaving: boolean;
  /** 0～1；上傳時才有。 */
  progress?: number;
  error?: string;
  onConfirm: (crop: ImageCrop) => void;
  onClose: () => void;
}

/**
 * 裁切（docs/architecture/frontend/23-image-picker.md §5）：前端只送比例的範圍，由伺服器套用，不在瀏覽器重新編碼。
 * 確定之後在這裡顯示上傳進度；關掉對話框就放棄上傳。
 */
export function ImageCropDialog({
  usage,
  preview,
  initialCrop,
  shape,
  isSaving,
  progress,
  error,
  onConfirm,
  onClose,
}: ImageCropDialogProps) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState<ImageCrop | undefined>(initialCrop);
  const aspectRatio = usage.aspectRatio ?? undefined;

  const confirm = () => {
    const width = preview.width;
    const height = preview.height;
    // 沒動過裁切框：取中央（與裁切框一開始顯示的相同）
    const chosen =
      crop ??
      (width && height
        ? centeredCrop({ naturalWidth: width, naturalHeight: height, aspectRatio })
        : { x: 0, y: 0, width: 1, height: 1 });
    onConfirm(chosen);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('imagePicker.crop.title')}
      size="lg"
      data-testid="image-picker-crop-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={isSaving}
            onClick={confirm}
            data-testid="image-picker-crop-confirm"
          >
            {t('imagePicker.crop.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <ImageCropper
          src={preview.src}
          alt={t('imagePicker.crop.alt')}
          naturalWidth={preview.width}
          naturalHeight={preview.height}
          aspectRatio={aspectRatio}
          minWidth={usage.minWidth}
          minHeight={usage.minHeight}
          shape={shape === 'circle' ? 'circle' : 'rect'}
          value={crop}
          onValueChange={setCrop}
          labels={{ region: t('imagePicker.crop.region'), hint: t('imagePicker.crop.hint') }}
          data-testid="image-picker-cropper"
        />
        {isSaving && progress !== undefined && (
          <Progress
            value={Math.round(progress * 100)}
            className="w-full"
            aria-label={t('imagePicker.uploading')}
          />
        )}
        {error && <FormError>{error}</FormError>}
      </div>
    </Dialog>
  );
}
