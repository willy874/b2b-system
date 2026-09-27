import { useState } from 'react';

import { Icon } from '@/components/Icon';
import { cn } from '@/shared/utils';

import type { FileItemVM } from '../adapter';

interface FileThumbnailProps {
  item: FileItemVM;
  /** `card`：卡片上方的大預覽；`row`：列表的小圖示。 */
  variant: 'card' | 'row';
  /** 圖片載入失敗（網址過期）時通知重抓列表。 */
  onStaleUrl: () => void;
}

/**
 * 圖片顯示縮圖，其他類型顯示類型圖示。只有虛擬捲動渲染到的項目才會建立 `<img>`，
 * 再加上 `loading="lazy"`，捲過一萬筆也只下載看得到的那幾張；網址在時間窗內不變，重抓列表不會重新下載。
 */
export function FileThumbnail({ item, variant, onStaleUrl }: FileThumbnailProps) {
  // 以網址為準：重抓後拿到新網址就再試一次
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = item.previewUrl && item.previewUrl !== failedUrl ? item.previewUrl : null;

  if (url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => {
          setFailedUrl(url);
          onStaleUrl();
        }}
        className={cn(
          'block h-full w-full',
          variant === 'card' ? 'object-cover' : 'rounded object-cover',
        )}
        data-testid="file-thumbnail"
      />
    );
  }
  return (
    <span
      className="flex h-full w-full items-center justify-center text-[var(--color-fg-muted)]"
      data-testid="file-type-icon"
      data-value={item.kind}
    >
      <Icon name={item.icon} size={variant === 'card' ? 24 : 20} />
    </span>
  );
}
