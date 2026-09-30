import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import type { Readable, TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import type { Sharp } from 'sharp';

import { IMAGE_FORMAT_CONTENT_TYPE, ImageDecodeError, ImageProcessor } from './image-processor';
import type { DecodedImage, DecodeOptions, RenderedImage, RenderOptions } from './image-processor';

/** 解碼的像素上限（約 1 億像素，例：10000 × 10000）：擋掉「小檔案、超大尺寸」的解壓縮炸彈。 */
const MAX_INPUT_PIXELS = 100_000_000;
const DEFAULT_QUALITY = 82;
/** JPEG 沒有透明度：透明的部分鋪白底，而不是預設的黑底。 */
const JPEG_BACKGROUND = '#ffffff';

/**
 * libvips 的全域資源上限（PERF-07）：影像處理與服務 WebSocket 的是同一個程序。
 * - 每張圖的執行緒數：預設是 CPU 核心數，兩張大圖同時處理就會佔滿所有核心；
 * - 操作快取：預設 50 MB ／ 100 個操作 ／ 20 個檔案，變體每張只算一次，快取幾乎不會命中，只會佔記憶體。
 */
const LIBVIPS_THREADS = 2;
const LIBVIPS_CACHE = { memory: 16, files: 0, items: 20 } as const;

/** 串流寫到暫存檔，超過位元組上限就中斷（不把整個檔案讀進記憶體）。 */
class ByteLimit extends Transform {
  private total = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.total += chunk.length;
    if (this.total > this.maxBytes) {
      callback(new ImageDecodeError(`影像超過 ${this.maxBytes} 位元組的處理上限`));
      return;
    }
    callback(null, chunk);
  }
}

async function spoolToTempFile(input: Readable, maxBytes: number): Promise<string> {
  const path = join(tmpdir(), `b2b-image-${randomUUID()}`);
  try {
    await pipeline(input, new ByteLimit(maxBytes), createWriteStream(path));
    return path;
  } catch (error) {
    await rm(path, { force: true });
    if (error instanceof ImageDecodeError) throw error;
    throw new ImageDecodeError('無法讀取影像', { cause: error });
  }
}

/**
 * `ImageProcessor` 的 sharp（libvips）實作。sharp 是預編譯的原生套件，
 * 平台二進位檔隨 `@img/sharp-*` 選用依賴安裝，不需要編譯環境。
 *
 * 記憶體（PERF-07）：串流輸入先寫到暫存檔、再由 libvips 從檔案逐列解碼，而不是整份讀成 Buffer——
 * 128 MiB 的原圖不會變成 128 MiB 的 heap，縮圖時 libvips 也只需要一小段列緩衝（JPEG 還會 shrink-on-load）。
 */
@Injectable()
export class SharpImageProcessor extends ImageProcessor {
  constructor() {
    super();
    sharp.concurrency(LIBVIPS_THREADS);
    sharp.cache(LIBVIPS_CACHE);
  }

  async decode(input: Readable | Buffer, options: DecodeOptions): Promise<DecodedImage> {
    if (Buffer.isBuffer(input) && input.length > options.maxBytes) {
      throw new ImageDecodeError(`影像超過 ${options.maxBytes} 位元組的處理上限`);
    }
    const tempPath = Buffer.isBuffer(input)
      ? undefined
      : await spoolToTempFile(input, options.maxBytes);
    const dispose = async () => {
      if (tempPath) await rm(tempPath, { force: true });
    };
    // animated: false —— GIF / 動態 WebP 只取第一格；autoOrient —— 依 EXIF 轉正
    const image = sharp(tempPath ?? (input as Buffer), {
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
      autoOrient: true,
      failOn: 'error',
      sequentialRead: true,
    });
    let metadata;
    try {
      metadata = await image.metadata();
    } catch (error) {
      await dispose();
      throw new ImageDecodeError('無法解碼影像', { cause: error });
    }
    const width = metadata.autoOrient.width;
    const height = metadata.autoOrient.height;
    if (!width || !height) {
      await dispose();
      throw new ImageDecodeError('影像沒有尺寸');
    }
    const info = { width, height, hasAlpha: metadata.hasAlpha };

    return {
      info,
      render: (renderOptions) => render(image.clone(), info.hasAlpha, renderOptions),
      dispose,
    };
  }
}

async function render(
  image: Sharp,
  hasAlpha: boolean,
  options: RenderOptions,
): Promise<RenderedImage> {
  if (options.maxEdge !== undefined) {
    image.resize({
      width: options.maxEdge,
      height: options.maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  const quality = options.quality ?? DEFAULT_QUALITY;
  switch (options.format) {
    case 'jpeg':
      if (hasAlpha) image.flatten({ background: JPEG_BACKGROUND });
      // mozjpeg 的預設就是 progressive；明寫出來，這是對外承諾的格式
      image.jpeg({ quality, progressive: true, mozjpeg: true });
      break;
    case 'webp':
      image.webp({ quality });
      break;
    case 'avif':
      image.avif({ quality, effort: 4 });
      break;
    case 'png':
      image.png({ compressionLevel: 9 });
      break;
  }
  try {
    const { data, info } = await image.toBuffer({ resolveWithObject: true });
    return {
      data,
      contentType: IMAGE_FORMAT_CONTENT_TYPE[options.format],
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    throw new ImageDecodeError('無法輸出影像', { cause: error });
  }
}
