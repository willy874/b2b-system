import { Button } from '@b2b-system/ui/Button';
import { Spinner } from '@b2b-system/ui/Spinner';
import { cn } from '@b2b-system/web-shared/utils';
import { useId, useState } from 'react';
import type { ClipboardEvent, DragEvent, ReactNode } from 'react';

import { SignedImage } from '../image';
import type { ImageSources } from '../image';
import { useTranslation } from '../locales';
import { useToast } from '../notify';
import { ImageCropDialog } from './ImageCropDialog';
import { ImageSourceDialog } from './ImageSourceDialog';
import type { ImageCrop, PickedImageAsset } from './types';
import { useImagePicker } from './useImagePicker';

const SHAPE_CLASS = {
  circle: 'rounded-full',
  square: 'rounded-md',
} as const satisfies Record<'circle' | 'square', string>;

export interface ImageFieldProps {
  /** 用途 id（例：`user.avatar`）：決定限制、裁切的比例與可以用的來源。 */
  usage: string;
  /** 目前的圖（api 回應裡的 `ImageSources`）；`null` 是沒有圖、或還在處理。 */
  value: ImageSources | null;
  /** 目前那張的圖片資產 id：有值時可以重新裁切與移除。 */
  assetId: string | null;
  /** 顯示哪一個具名的版本（例：頭像的 `lg`）。 */
  variant: string;
  alt: string;
  /** 顯示的大小（px）。 */
  size?: number;
  shape?: 'circle' | 'square';
  /** 沒有圖時顯示（例：名字縮寫的 `Avatar`）。 */
  fallback?: ReactNode;
  /** 換了一張（`null` 是移除）：呼叫端把資產 id 存到自己的資源（例：`PATCH /auth/profile { avatarImageId }`）。 */
  onChange: (change: { assetId: string | null; asset?: PickedImageAsset }) => void;
  /** 重新裁切目前那張（例：`PATCH /auth/profile { avatarCrop }`）；沒給時不顯示「裁切」。 */
  onRecrop?: (crop: ImageCrop) => void;
  /** 見 `SignedImage` 的 `onExpired`。 */
  onExpired?: () => void;
  /** 呼叫端正在儲存。 */
  pending?: boolean;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * 圖片欄位（docs/architecture/frontend/23-image-picker.md §1）：顯示目前的圖，「更換」「裁切」「移除」；
 * 焦點在欄位上時可以直接貼上圖片，也可以把圖片拖到欄位上。選好之後在伺服器處理完之前先顯示選的圖。
 */
export function ImageField({
  usage: usageId,
  value,
  assetId,
  variant,
  alt,
  size = 96,
  shape = 'square',
  fallback,
  onChange,
  onRecrop,
  onExpired,
  pending = false,
  disabled = false,
  className,
  'data-testid': testId = 'image-field',
}: ImageFieldProps) {
  const { t } = useTranslation();
  const toast = useToast();
  /** 選好、伺服器還沒處理完的圖：資產 id 換成它而且有了網址之後就不再需要。 */
  const [local, setLocal] = useState<{ assetId: string; src: string }>();
  const [isDragging, setDragging] = useState(false);
  const picker = useImagePicker({
    usage: usageId,
    onPicked: ({ asset, preview }) => {
      if (preview) setLocal({ assetId: asset.id, src: preview.src });
      onChange({ assetId: asset.id, asset });
    },
    onRecrop: (crop) => {
      setLocal(undefined);
      onRecrop?.(crop);
    },
  });
  const { usage, step, fileInputRef } = picker;
  const hintId = useId();
  const isBusy = pending || picker.isOpening || picker.isSaving;
  const isDisabled = disabled || !usage;
  const showLocal = local && !(local.assetId === assetId && value);

  const onPaste = (event: ClipboardEvent<HTMLButtonElement>) => {
    if (isDisabled || step.name !== 'idle') return;
    const files = [...event.clipboardData.files];
    // 貼上的不是圖片（例：一段網址）就不攔截
    if (!files.some((file) => file.type.startsWith('image/'))) return;
    event.preventDefault();
    picker.acceptFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    if (isDisabled) return;
    if (event.dataTransfer.files.length === 0) {
      if (event.dataTransfer.types.includes('text/uri-list')) toast.error(t('imagePicker.urlDrop'));
      return;
    }
    picker.acceptFiles([...event.dataTransfer.files]);
  };

  return (
    <div className={cn('flex items-center gap-4', className)} data-testid={testId}>
      {/* 預覽本身是按鈕：按下等同「更換」；聚焦時直接貼上圖片（不做全頁攔截），也可以把圖片拖到上面 */}
      <button
        type="button"
        disabled={isDisabled}
        aria-label={t('imagePicker.field', { name: alt })}
        aria-describedby={hintId}
        title={t('imagePicker.pasteHint')}
        onClick={() => void picker.open()}
        onPointerEnter={picker.prefetch}
        className={cn(
          'relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden border-0 bg-[var(--color-fill-subtle)] p-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-default',
          SHAPE_CLASS[shape],
          isDragging && 'ring-2 ring-[var(--color-brand)]',
        )}
        style={{ width: size, height: size }}
        onPaste={onPaste}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isDisabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="image-field-preview"
        data-state={showLocal ? 'processing' : value ? 'ready' : 'empty'}
      >
        {showLocal ? (
          <img src={local.src} alt={alt} className="h-full w-full object-cover" />
        ) : (
          <SignedImage
            sources={value}
            variant={variant}
            alt={alt}
            onExpired={onExpired}
            fallback={fallback}
            className="block h-full w-full [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
          />
        )}
        {(showLocal || isBusy) && (
          <span className="absolute inset-0 flex items-center justify-center bg-[var(--color-backdrop)]">
            <Spinner size={20} label={t('imagePicker.processing')} />
          </span>
        )}
      </button>
      <span id={hintId} hidden>
        {t('imagePicker.pasteHint')}
      </span>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={isDisabled}
          loading={picker.isOpening}
          onPointerEnter={picker.prefetch}
          onFocus={picker.prefetch}
          onClick={() => void picker.open()}
          data-testid="image-field-change"
        >
          {t('imagePicker.change')}
        </Button>
        {assetId && onRecrop && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isDisabled || isBusy}
            onClick={() => void picker.recrop(assetId)}
            data-testid="image-field-recrop"
          >
            {t('imagePicker.recrop')}
          </Button>
        )}
        {assetId && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isDisabled || isBusy}
            onClick={() => {
              setLocal(undefined);
              onChange({ assetId: null });
            }}
            data-testid="image-field-remove"
          >
            {t('imagePicker.remove')}
          </Button>
        )}
      </div>
      {/* 只剩上傳時直接打開作業系統的選檔視窗 */}
      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept={usage?.contentTypes.join(',')}
        onChange={(event) => {
          picker.acceptFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
        data-testid="image-field-input"
      />
      {usage && step.name === 'choosing' && (
        <ImageSourceDialog
          usage={usage}
          sources={step.sources}
          tab={step.tab}
          onTabChange={(tab) => picker.setStep({ ...step, tab })}
          onFiles={picker.acceptFiles}
          onSelect={(selection) => void picker.select(selection)}
          onClose={picker.close}
        />
      )}
      {usage && step.name === 'cropping' && (
        <ImageCropDialog
          usage={usage}
          preview={step.preview}
          initialCrop={step.initialCrop}
          shape={shape}
          isSaving={picker.isSaving}
          progress={picker.progress}
          error={picker.error}
          onConfirm={(crop) => void picker.confirmCrop(crop)}
          onClose={picker.close}
        />
      )}
    </div>
  );
}
