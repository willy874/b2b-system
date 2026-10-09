import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useErrorMessage } from '../errors';
import { useTranslation } from '../locales';
import { useToast } from '../notify';
import { usePermission } from '../permission';
import { invalidateSourceAvailability, resolveAvailableSources, usageAllows } from './availability';
import { UPLOAD_IMAGE_SOURCE, useImagePickerApi, useImageSources } from './registry';
import type {
  ImageCrop,
  ImageSelection,
  ImageSourceDefinition,
  ImageUsage,
  PickedImageAsset,
} from './types';
import { firstImageFile, validateImageFile } from './validate';

export const IMAGE_USAGES_QUERY_KEY = 'IMAGE_USAGES_QUERY_KEY';

/** 裁切時顯示的圖：上傳的是本機的 object URL，其他來源是它的預覽，重新裁切是主檔。 */
export interface CropPreview {
  src: string;
  /** 原圖的尺寸（預覽可能是縮小版）；不知道時是 undefined，由圖片載入後的尺寸代替。 */
  width?: number;
  height?: number;
}

export type ImagePickerStep =
  | { name: 'idle' }
  | { name: 'choosing'; sources: ImageSourceDefinition[]; tab: string }
  | {
      name: 'cropping';
      /** `undefined` 是重新裁切目前那張。 */
      selection: ImageSelection | undefined;
      preview: CropPreview;
      initialCrop?: ImageCrop;
    };

/** 選好、上傳好之後交給呼叫端的結果；`preview` 讓畫面在伺服器處理完之前先顯示選的圖。 */
export interface ImagePicked {
  asset: PickedImageAsset;
  preview: CropPreview | undefined;
  crop: ImageCrop | undefined;
}

export interface UseImagePickerOptions {
  usage: string;
  onPicked: (picked: ImagePicked) => void;
  /** 重新裁切目前那張（不必重傳）；沒給時不能重新裁切。 */
  onRecrop?: (crop: ImageCrop) => void;
}

/** 依用途查限制（部署更新才會變：快取到頁面重新載入，docs/architecture/backend/25-image.md §16.2 D8）。 */
export function useImageUsage(usageId: string): ImageUsage | undefined {
  const api = useImagePickerApi();
  const { data } = useQuery({
    queryKey: [IMAGE_USAGES_QUERY_KEY],
    queryFn: () => (api ? api.getUsages() : []),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: api !== undefined,
  });
  return data?.find((usage) => usage.id === usageId);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** 一張貼上的圖片的名稱：「貼上的圖片 2026-10-09 14:32.png」，「最近使用」才分得出來。 */
export function pastedImageName(prefix: string, now: Date, contentType: string): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  return `${prefix} ${stamp}.${extension}`;
}

/**
 * 選圖的流程（docs/architecture/frontend/23-image-picker.md §3）：
 * 按「更換」→ 判斷哪些來源可用 → 只剩上傳時直接開選檔視窗，否則開來源對話框 → 選好（或貼上、拖進）→
 * 檢查 → 用途有比例時裁切 → 上傳或從來源複製 → `onPicked`。
 */
export function useImagePicker({ usage: usageId, onPicked, onRecrop }: UseImagePickerOptions) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const api = useImagePickerApi();
  const queryClient = useQueryClient();
  const { can } = usePermission();
  const usage = useImageUsage(usageId);
  const registered = useImageSources();
  const [step, setStep] = useState<ImagePickerStep>({ name: 'idle' });
  const [isOpening, setOpening] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  const abort = useRef<AbortController | undefined>(undefined);

  // 本機的預覽（object URL）在元件卸載時釋放
  useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      abort.current?.abort();
    },
    [],
  );

  const context = useCallback(
    (current: ImageUsage) => ({ usage: current, can, queryClient }),
    [can, queryClient],
  );

  /** 滑過或取得焦點時預先判斷：按下時通常已經有答案。 */
  const prefetch = useCallback(() => {
    if (usage) void resolveAvailableSources(registered, context(usage));
  }, [usage, registered, context]);

  const close = useCallback(() => {
    abort.current?.abort();
    setStep({ name: 'idle' });
    setSaving(false);
    setProgress(undefined);
    setError(undefined);
  }, []);

  const open = useCallback(async () => {
    if (!usage) return;
    setOpening(true);
    try {
      const sources = await resolveAvailableSources(registered, context(usage));
      // 只剩上傳：不出現來源選擇，直接開作業系統的選檔視窗
      if (sources.length === 0) fileInputRef.current?.click();
      else setStep({ name: 'choosing', sources, tab: UPLOAD_IMAGE_SOURCE });
    } finally {
      setOpening(false);
    }
  }, [usage, registered, context]);

  const commit = useCallback(
    async (selection: ImageSelection, preview: CropPreview | undefined, crop?: ImageCrop) => {
      if (!usage || !api) return;
      setSaving(true);
      setError(undefined);
      const controller = new AbortController();
      abort.current = controller;
      try {
        const asset =
          selection.kind === 'file'
            ? await api.upload({
                usage: usage.id,
                file: selection.file,
                name: selection.name,
                contentType: selection.file.type,
                crop,
                signal: controller.signal,
                onProgress: setProgress,
              })
            : await api.fromSource({
                usage: usage.id,
                source: selection.source,
                refId: selection.refId,
                crop,
              });
        void invalidateSourceAvailability(queryClient);
        close();
        onPicked({ asset, preview, crop });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(errorMessage(caught));
      } finally {
        setSaving(false);
        setProgress(undefined);
      }
    },
    [usage, api, queryClient, close, onPicked, errorMessage],
  );

  const select = useCallback(
    async (selection: ImageSelection) => {
      if (!usage) return;
      setError(undefined);
      let preview: CropPreview | undefined;
      let file = selection.kind === 'file' ? selection.file : undefined;
      if (selection.kind === 'file' && file) {
        const result = await validateImageFile(file, usage);
        if (result.issue) {
          toast.error(t(result.issue.messageKey, result.issue.params));
          return;
        }
        // 宣告的型別以檔頭為準（貼上的圖片常常沒有型別）
        if (result.contentType && result.contentType !== file.type) {
          file = new File([file], selection.name, { type: result.contentType });
        }
        const src = URL.createObjectURL(file);
        objectUrls.current.push(src);
        preview = { src, width: result.size?.width, height: result.size?.height };
      } else if (selection.kind === 'source' && selection.preview) {
        preview = selection.preview;
      }
      const chosen: ImageSelection = file ? { ...selection, kind: 'file', file } : selection;
      // 用途有比例：一定先裁切；沒有比例就直接上傳（之後仍可裁切）
      if (usage.aspectRatio !== null && preview) {
        setStep({ name: 'cropping', selection: chosen, preview });
        return;
      }
      await commit(chosen, preview);
    },
    [usage, toast, t, commit],
  );

  /** 拖曳、貼上、選檔視窗交來的檔案：只取第一張圖片。 */
  const acceptFiles = useCallback(
    (files: readonly File[]) => {
      if (!usage || !usageAllows(usage, UPLOAD_IMAGE_SOURCE)) return;
      const { file, count } = firstImageFile(files);
      if (!file) return;
      if (count > 1) toast.success(t('imagePicker.onlyFirst'));
      const name =
        file.name && file.name !== 'image.png'
          ? file.name
          : pastedImageName(t('imagePicker.pastedName'), new Date(), file.type || 'image/png');
      void select({ kind: 'file', file, name });
    },
    [usage, toast, t, select],
  );

  /** 重新裁切目前那張：要主檔的網址，只有建立者拿得到；拿不到就說明不能裁切。 */
  const recrop = useCallback(
    async (assetId: string) => {
      if (!api) return;
      setOpening(true);
      try {
        const asset = await api.getAsset(assetId);
        const { original } = asset;
        if (!original) throw new Error('沒有主檔');
        setStep({
          name: 'cropping',
          selection: undefined,
          preview: { src: original.url, width: original.width, height: original.height },
          initialCrop: asset.crop ?? undefined,
        });
      } catch {
        toast.error(t('imagePicker.recropUnavailable'));
      } finally {
        setOpening(false);
      }
    },
    [api, toast, t],
  );

  const confirmCrop = useCallback(
    async (crop: ImageCrop) => {
      if (step.name !== 'cropping') return;
      if (!step.selection) {
        close();
        onRecrop?.(crop);
        return;
      }
      await commit(step.selection, step.preview, crop);
    },
    [step, close, commit, onRecrop],
  );

  return {
    usage,
    step,
    setStep,
    isOpening,
    isSaving,
    progress,
    error,
    fileInputRef,
    prefetch,
    open,
    close,
    select,
    acceptFiles,
    recrop,
    confirmCrop,
  };
}

export type ImagePickerController = ReturnType<typeof useImagePicker>;
