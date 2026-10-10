import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type { ImageSources } from './types';

/** 長時間開著的頁面在網址到期前多久主動重抓（與檔案管理器的「失效前 60 秒重抓」相同）。 */
const REFRESH_BEFORE_EXPIRY_MS = 60_000;
/** `setTimeout` 能接受的最大延遲（約 24.8 天）；超過會被當成 1ms 立刻觸發，等於一直重抓。 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface SignedImageProps {
  /** api 回應裡的圖；`null` / `undefined` 代表沒有圖片或還在處理，直接顯示退路。 */
  sources: ImageSources | null | undefined;
  /** 要顯示的具名版本（例：頭像的 `sm`）；以名稱挑選，不寫死像素。 */
  variant: string;
  alt: string;
  /** 寬度描述（`480w`）的版本要搭配它，例：`(min-width: 768px) 33vw, 100vw`。 */
  sizes?: string;
  /**
   * 載入失敗（多半是網址過期）時呼叫一次：讓擁有這筆資料的查詢失效，重抓後拿到新網址就自動重試。
   * 同一頁的多張圖用 `coalesce()` 包起來，只失效一次。沒給時直接顯示退路。
   */
  onExpired?: () => void;
  /**
   * 長時間開著、會繼續載入新圖的頁面（無限捲動、檢視器的預先載入）：在 `expiresAt` 前 60 秒主動呼叫 `onExpired`。
   * 其他頁面不需要：已經顯示的圖不需要新網址（docs/architecture/backend/25-image.md §5 D7）。
   */
  isLongLived?: boolean;
  /** 沒有圖片、或重抓之後仍載入失敗時顯示（頭像退回縮寫、圖片庫退回主色色塊）。 */
  fallback?: ReactNode;
  loading?: 'lazy' | 'eager';
  className?: string;
  'data-testid'?: string;
}

/**
 * 顯示 api 簽好的圖片網址（docs/architecture/backend/25-image.md §5）：`<picture>` 依序列出其他格式與主格式，
 * 寬高讓版面不跳動；失敗時先重抓一次網址，仍失敗才顯示退路。
 */
export function SignedImage({
  sources,
  variant,
  alt,
  sizes,
  onExpired,
  isLongLived = false,
  fallback = null,
  loading = 'lazy',
  className,
  'data-testid': testId,
}: SignedImageProps) {
  const image = sources?.variants[variant];
  const src = image?.src;
  /** 已經為了它呼叫過 `onExpired` 的網址；載入成功就清掉，下一次過期可以再重抓。 */
  const [retriedSrc, setRetriedSrc] = useState<string>();
  /** 重抓之後仍失敗的網址：顯示退路，直到資料換成別的網址。 */
  const [failedSrc, setFailedSrc] = useState<string>();

  const expiresAt = sources?.expiresAt;
  useEffect(() => {
    if (!isLongLived || !onExpired || !expiresAt) return;
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now() - REFRESH_BEFORE_EXPIRY_MS);
    if (delay > MAX_TIMEOUT_MS) return;
    const timer = setTimeout(onExpired, delay);
    return () => clearTimeout(timer);
  }, [isLongLived, onExpired, expiresAt]);

  if (!image || !src || failedSrc === src) return <>{fallback}</>;

  const handleError = () => {
    if (onExpired && retriedSrc === undefined) {
      setRetriedSrc(src);
      onExpired();
      return;
    }
    setFailedSrc(src);
  };

  return (
    <picture className={className} data-testid={testId}>
      {image.sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={sizes} />
      ))}
      <img
        src={src}
        srcSet={image.srcSet}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={alt}
        loading={loading}
        decoding="async"
        onLoad={() => setRetriedSrc(undefined)}
        onError={handleError}
      />
    </picture>
  );
}
