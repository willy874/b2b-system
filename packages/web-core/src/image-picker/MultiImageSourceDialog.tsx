import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Empty } from '@b2b-system/ui/Empty';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { Tabs } from '@b2b-system/ui/Tabs';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { useErrorMessage } from '../errors';
import { loadLocaleScope, useTranslation } from '../locales';
import { useToast } from '../notify';
import type { ImageSourceItem, ImageSourceMultiple, ImageUsage } from './types';
import { useMultiImageSources } from './useMultiImageSources';

/** api 的 `from-source` 一次最多收幾張。 */
const DEFAULT_MAX = 100;

export interface MultiImageSourceDialogProps {
  /** 用途：其他來源以它過濾（例：api 的 `gallery.item`，只用來過濾、不能建立圖片資產）。要是穩定的參照（例：`useImageUsage()` 的結果）。 */
  usage: ImageUsage;
  /** 不列出的來源 id（例：呼叫端自己，`'gallery'`）。上傳與「最近使用」一律不列。 */
  exclude?: readonly string[];
  title: string;
  /** 確認鈕的文字（`{{count}}` 由呼叫端組好，例：`t('...', { count })`）的產生函式。 */
  confirmLabel: (count: number) => string;
  /** 一次最多幾張（api 的 from-source 上限是 100）。 */
  max?: number;
  /**
   * 送出：同一個來源的多筆。對話框不會自己關閉，成功後由呼叫端關閉；
   * 丟出例外時顯示錯誤訊息、保留勾選，讓使用者再試一次。
   */
  onConfirm: (input: { source: string; items: ImageSourceItem[] }) => void | Promise<void>;
  onClose: () => void;
}

/**
 * 從其他來源一次挑多張（docs/architecture/frontend/23-image-picker.md §2.1）：每個支援多選的來源一個分頁，勾選只在一個來源內
 * （後端一次只收一個來源），切換分頁時清空。
 */
export function MultiImageSourceDialog({
  usage,
  exclude,
  title,
  confirmLabel,
  max = DEFAULT_MAX,
  onConfirm,
  onClose,
}: MultiImageSourceDialogProps) {
  const { t, language } = useTranslation();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const sources = useMultiImageSources(usage, exclude);
  const [tab, setTab] = useState<string>();
  // 以插入順序保存：送出的順序就是勾選的順序
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map());
  const [isSubmitting, setSubmitting] = useState(false);

  // 來源元件的語系包：呼叫端的頁面不一定載入過
  useEffect(() => {
    for (const { localeScope } of sources ?? []) {
      if (localeScope) loadLocaleScope(localeScope, language).catch(() => undefined);
    }
  }, [sources, language]);

  const active = sources?.find((source) => source.id === tab) ?? sources?.[0];
  const Component = active?.component;

  const onToggle = useCallback(
    ({ refId, name }: ImageSourceItem) => {
      if (!picked.has(refId) && picked.size >= max) {
        toast.error(t('imagePicker.multiple.limit', { max }));
        return;
      }
      setPicked((current) => {
        const next = new Map(current);
        if (next.has(refId)) next.delete(refId);
        else next.set(refId, name);
        return next;
      });
    },
    [picked, max, toast, t],
  );

  const multiple = useMemo<ImageSourceMultiple>(
    () => ({ selected: new Set(picked.keys()), onToggle }),
    [picked, onToggle],
  );

  const confirm = async () => {
    if (!active || picked.size === 0) return;
    setSubmitting(true);
    try {
      await onConfirm({
        source: active.id,
        items: [...picked].map(([refId, name]) => ({ refId, name })),
      });
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      size="lg"
      data-testid="image-picker-multiple-dialog"
      footer={
        <>
          <span
            className="mr-auto text-sm text-[var(--color-fg-muted)]"
            data-testid="image-picker-multiple-count"
            data-value={picked.size}
          >
            {t('imagePicker.multiple.count', { count: picked.size, max })}
          </span>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            loading={isSubmitting}
            onClick={() => void confirm()}
            data-testid="image-picker-multiple-confirm"
          >
            {confirmLabel(picked.size)}
          </Button>
        </>
      }
    >
      {sources === undefined ? (
        <Skeleton width="100%" height={160} />
      ) : !active || !Component ? (
        <Empty
          title={t('imagePicker.multiple.empty')}
          description={t('imagePicker.multiple.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Tabs
            value={active.id}
            onValueChange={(value) => {
              if (value === active.id) return;
              // 後端一次只收一個來源：換來源就重新勾選
              setTab(value);
              setPicked(new Map());
            }}
            moreLabel={t('common.more')}
            tabs={sources.map((source) => ({ value: source.id, label: t(source.labelKey) }))}
            data-testid="image-picker-multiple-tabs"
          />
          {/* 來源的本體多半是 lazy 載入（只在打開時才需要）；換來源時重新掛載，來源內的狀態（資料夾）跟著重設 */}
          <Suspense fallback={<Skeleton width="100%" height={160} />}>
            <Component key={active.id} usage={usage} onSelect={ignoreSelect} multiple={multiple} />
          </Suspense>
        </div>
      )}
    </Dialog>
  );
}

/** 多選模式的來源不呼叫 `onSelect`（`ImageSourceProps` 要求這個 prop）。 */
function ignoreSelect(): void {
  // 刻意不做事：勾選走 `multiple.onToggle`
}
