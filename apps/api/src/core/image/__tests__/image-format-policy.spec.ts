import { describe, expect, it, vi } from 'vitest';

import {
  deliveryFormatsOf,
  primaryFormatOf,
  renderRenditions,
  renditionKey,
} from '../image-format-policy';
import type { DecodedImage, RenderOptions } from '../image-processor';

describe('影像的格式政策（docs/architecture/backend/25-image.md §11 D2、D9）', () => {
  it.each([
    { hasAlpha: false, primary: 'jpeg', delivery: ['jpeg', 'webp'] },
    { hasAlpha: true, primary: 'webp', delivery: ['webp'] },
  ])('hasAlpha=$hasAlpha：主格式 $primary，產生 $delivery', ({ hasAlpha, primary, delivery }) => {
    expect(primaryFormatOf({ hasAlpha })).toBe(primary);
    expect(deliveryFormatsOf({ hasAlpha })).toEqual(delivery);
  });

  it('物件 key 是 <prefix>/<名稱>.<副檔名>，JPEG 用 .jpg', () => {
    expect(renditionKey('images/a/r3', 'sm@2x', 'jpeg')).toBe('images/a/r3/sm@2x.jpg');
    expect(renditionKey('images/a/r3', 'sm', 'webp')).toBe('images/a/r3/sm.webp');
  });
});

describe('renderRenditions', () => {
  it('每個尺寸 × 格式各輸出一次，依序執行（同時只有一個 render），並帶上裁切範圍', async () => {
    let running = 0;
    let peak = 0;
    const render = vi.fn(async (options: RenderOptions) => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return {
        data: Buffer.from(options.format),
        contentType: `image/${options.format}`,
        width: options.maxEdge ?? 100,
        height: options.maxEdge ?? 100,
      };
    });
    const decoded = {
      info: { width: 100, height: 100, hasAlpha: false },
      render,
    } as unknown as DecodedImage;
    const extract = { left: 0, top: 0, width: 100, height: 100 };

    const results = await renderRenditions(decoded, {
      renditions: [{ name: 'sm', maxEdge: 32 }, { name: 'master' }],
      formats: ['jpeg', 'webp'],
      extract,
    });

    expect(results.map(({ name, format, width }) => [name, format, width])).toEqual([
      ['sm', 'jpeg', 32],
      ['sm', 'webp', 32],
      ['master', 'jpeg', 100],
      ['master', 'webp', 100],
    ]);
    expect(peak).toBe(1);
    expect(render).toHaveBeenCalledWith({ format: 'jpeg', maxEdge: 32, extract });
  });
});
