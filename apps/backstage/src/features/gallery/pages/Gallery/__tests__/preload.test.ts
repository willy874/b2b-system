import { describe, expect, it } from 'vitest';

import { preloadImageVariant } from '../preload';

describe('preloadImageVariant（檢視器的預先載入，docs/architecture/frontend/24-gallery.md §9）', () => {
  it('有其他格式時與檢視器同一個 <picture> 結構：<source> 在 <img> 前面、設定 src 之前就放好', () => {
    const image = preloadImageVariant({
      src: 'https://storage/large.jpg',
      sources: [{ type: 'image/webp', srcSet: 'https://storage/large.webp' }],
    });
    const picture = image.parentElement;
    expect(picture?.tagName).toBe('PICTURE');
    const [source, last] = Array.from(picture!.children);
    expect(source).toBeInstanceOf(HTMLSourceElement);
    expect((source as HTMLSourceElement).type).toBe('image/webp');
    expect((source as HTMLSourceElement).srcset).toBe('https://storage/large.webp');
    expect(last).toBe(image);
    expect(image.getAttribute('src')).toBe('https://storage/large.jpg');
    // 不放進文件：只是讓瀏覽器挑格式並抓進快取
    expect(picture!.isConnected).toBe(false);
  });

  it('沒有其他格式時只是一個 <img>', () => {
    const image = preloadImageVariant({ src: 'https://storage/large.png', sources: [] });
    expect(image.parentElement).toBeNull();
    expect(image.getAttribute('src')).toBe('https://storage/large.png');
  });
});
