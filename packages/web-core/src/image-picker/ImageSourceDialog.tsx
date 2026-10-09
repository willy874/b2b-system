import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { Tabs } from '@b2b-system/ui/Tabs';
import { Suspense, useEffect } from 'react';
import type { DragEvent } from 'react';

import { loadLocaleScope, useTranslation } from '../locales';
import { useToast } from '../notify';
import { UPLOAD_IMAGE_SOURCE } from './registry';
import type { ImageSelection, ImageSourceDefinition, ImageUsage } from './types';
import { UploadSource } from './UploadSource';

interface ImageSourceDialogProps {
  usage: ImageUsage;
  sources: readonly ImageSourceDefinition[];
  tab: string;
  onTabChange: (tab: string) => void;
  onFiles: (files: readonly File[]) => void;
  onSelect: (selection: ImageSelection) => void;
  onClose: () => void;
}

/** 拖曳進來的是網頁上的圖片（只有網址、沒有檔案）：那其實是「從網址匯入」，這一版不做。 */
function isUrlOnlyDrop(event: DragEvent): boolean {
  return (
    event.dataTransfer.files.length === 0 && event.dataTransfer.types.includes('text/uri-list')
  );
}

/**
 * 來源選擇（docs/architecture/frontend/23-image-picker.md §2）：每個可用的來源一個分頁，「上傳」固定在第一個。
 * 開著的時候可以直接貼上（⌘V／Ctrl+V）；拖進對話框時自動切到「上傳」。
 */
export function ImageSourceDialog({
  usage,
  sources,
  tab,
  onTabChange,
  onFiles,
  onSelect,
  onClose,
}: ImageSourceDialogProps) {
  const { t, language } = useTranslation();
  const toast = useToast();

  // 來源元件的語系包：選圖的頁面不一定載入過（例：在個人資料頁挑檔案管理的圖）
  useEffect(() => {
    for (const { localeScope } of sources) {
      if (localeScope) loadLocaleScope(localeScope, language).catch(() => undefined);
    }
  }, [sources, language]);

  // 對話框開著時才處理貼上（不做全頁攔截）；貼上的不是圖片就不攔截
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (!files.some((file) => file.type.startsWith('image/'))) return;
      event.preventDefault();
      onFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onFiles]);

  const active = sources.find((source) => source.id === tab);
  const Component = active?.component;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('imagePicker.title')}
      description={t('imagePicker.pasteHint')}
      size="lg"
      data-testid="image-picker-dialog"
    >
      <div
        className="flex flex-col gap-3"
        onDragOver={(event) => {
          event.preventDefault();
          if (tab !== UPLOAD_IMAGE_SOURCE) onTabChange(UPLOAD_IMAGE_SOURCE);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (isUrlOnlyDrop(event)) {
            toast.error(t('imagePicker.urlDrop'));
            return;
          }
          onFiles([...event.dataTransfer.files]);
        }}
      >
        <Tabs
          value={tab}
          onValueChange={onTabChange}
          moreLabel={t('common.more')}
          tabs={[
            { value: UPLOAD_IMAGE_SOURCE, label: t('imagePicker.upload.label') },
            ...sources.map((source) => ({ value: source.id, label: t(source.labelKey) })),
          ]}
          data-testid="image-picker-tabs"
        />
        {tab === UPLOAD_IMAGE_SOURCE || !Component ? (
          <UploadSource usage={usage} onFiles={onFiles} />
        ) : (
          // 來源的本體多半是 lazy 載入（只在打開選圖時才需要）
          <Suspense fallback={<Skeleton width="100%" height={160} />}>
            <Component usage={usage} onSelect={onSelect} />
          </Suspense>
        )}
      </div>
    </Dialog>
  );
}
