import type { ImageSourceVariant } from '@b2b-system/web-core/image';

/**
 * 預先載入檢視器會顯示的那個檔案（docs/architecture/frontend/24-gallery.md §9「預先載入」）。
 * 檢視器以 `<picture>` 顯示：瀏覽器支援 `<source>` 的格式（例：WebP）時抓的是 `<source>`，不是 `<img>` 的 `src`。
 * 只抓 `src` 的話預先載入的檔案用不上，換圖時還是要重抓；所以照同一個結構建一個不放進文件的 `<picture>`，
 * 由瀏覽器自己挑格式。`<source>` 要在 `<img>` 設定 `src` 之前就放好，選擇才會考慮它們。
 */
export function preloadImageVariant(
  variant: Pick<ImageSourceVariant, 'src' | 'sources'>,
): HTMLImageElement {
  const image = document.createElement('img');
  image.decoding = 'async';
  if (variant.sources.length > 0) {
    const picture = document.createElement('picture');
    for (const source of variant.sources) {
      const element = document.createElement('source');
      element.type = source.type;
      element.srcset = source.srcSet;
      picture.append(element);
    }
    picture.append(image);
  }
  image.src = variant.src;
  return image;
}
