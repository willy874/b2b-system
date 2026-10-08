import { afterEach, describe, expect, it, vi } from 'vitest';

import { imageThumbnailGenerator } from '../imageThumbnail';

const png = (name = 'a.png', type = 'image/png') => new File(['x'], name, { type });

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

function fakeContext() {
  return { drawImage: vi.fn(), imageSmoothingQuality: 'low' };
}

/** 假的 OffscreenCanvas：記下尺寸，`convertToBlob` 回傳一個 WebP。 */
function stubOffscreenCanvas(context: unknown = fakeContext()) {
  const canvases: Array<{
    width: number;
    height: number;
    convertToBlob: ReturnType<typeof vi.fn>;
  }> = [];
  class FakeOffscreenCanvas {
    convertToBlob = vi.fn(
      async (options: { type: string }) => new Blob(['t'], { type: options.type }),
    );
    constructor(
      public width: number,
      public height: number,
    ) {
      canvases.push(this);
    }
    getContext() {
      return context;
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return canvases;
}

describe('imageThumbnailGenerator（上傳時的縮圖）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('瀏覽器能解碼的點陣圖才產生；SVG、非圖片、不支援 createImageBitmap 都不產生', () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    expect(imageThumbnailGenerator.canGenerate(png())).toBe(true);
    expect(imageThumbnailGenerator.canGenerate(png('a.svg', 'image/svg+xml'))).toBe(false);
    expect(imageThumbnailGenerator.canGenerate(png('a.txt', 'text/plain'))).toBe(false);

    vi.stubGlobal('createImageBitmap', undefined);
    expect(imageThumbnailGenerator.canGenerate(png())).toBe(false);
  });

  it('長邊縮到 maxDimension、等比例，輸出 WebP 並釋放 bitmap', async () => {
    const bitmap = fakeBitmap(2000, 1000);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const context = fakeContext();
    const canvases = stubOffscreenCanvas(context);

    const blob = await imageThumbnailGenerator.generate(png(), {
      maxDimension: 400,
      maxBytes: 1_000_000,
    });

    expect(blob?.type).toBe('image/webp');
    expect(canvases[0]).toMatchObject({ width: 400, height: 200 });
    expect(canvases[0]?.convertToBlob).toHaveBeenCalledWith({ type: 'image/webp', quality: 0.8 });
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 400, 200);
    expect(context.imageSmoothingQuality).toBe('high');
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('比 maxDimension 小的圖不放大；極扁的圖至少 1 px', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(100, 50)),
    );
    const canvases = stubOffscreenCanvas();
    await imageThumbnailGenerator.generate(png(), { maxDimension: 400, maxBytes: 1_000_000 });
    expect(canvases[0]).toMatchObject({ width: 100, height: 50 });

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(10_000, 1)),
    );
    await imageThumbnailGenerator.generate(png(), { maxDimension: 100, maxBytes: 1_000_000 });
    expect(canvases[1]).toMatchObject({ width: 100, height: 1 });
  });

  it('超過像素上限不解碼、已取消、取不到 2D context → 回傳 undefined 並釋放 bitmap', async () => {
    const huge = fakeBitmap(10_000, 10_000);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => huge),
    );
    stubOffscreenCanvas();
    await expect(
      imageThumbnailGenerator.generate(png(), { maxDimension: 400, maxBytes: 1_000_000 }),
    ).resolves.toBe(undefined);
    expect(huge.close).toHaveBeenCalled();

    const aborted = fakeBitmap(10, 10);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => aborted),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      imageThumbnailGenerator.generate(png(), {
        maxDimension: 400,
        maxBytes: 1_000_000,
        signal: controller.signal,
      }),
    ).resolves.toBe(undefined);
    expect(aborted.close).toHaveBeenCalled();

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(10, 10)),
    );
    stubOffscreenCanvas(null);
    await expect(
      imageThumbnailGenerator.generate(png(), { maxDimension: 400, maxBytes: 1_000_000 }),
    ).resolves.toBe(undefined);
  });

  it('沒有 OffscreenCanvas 時退回 <canvas> 的 toBlob', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(800, 800)),
    );
    const context = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
      type,
    ) {
      callback(new Blob([`${this.width}x${this.height}`], { type }));
    });

    const blob = await imageThumbnailGenerator.generate(png(), {
      maxDimension: 200,
      maxBytes: 1_000_000,
    });

    expect(blob?.type).toBe('image/webp');
    await expect(blob?.text()).resolves.toBe('200x200');
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.8);
  });

  it('<canvas> 的 toBlob 失敗（回 null）→ 回傳 undefined', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(10, 10)),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext() as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(null),
    );

    await expect(
      imageThumbnailGenerator.generate(png(), { maxDimension: 200, maxBytes: 1_000_000 }),
    ).resolves.toBe(undefined);
  });
});
