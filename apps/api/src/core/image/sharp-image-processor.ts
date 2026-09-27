import type { Readable } from 'node:stream';

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

async function readAll(input: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maxBytes) {
      input.destroy();
      throw new ImageDecodeError(`影像超過 ${maxBytes} 位元組的處理上限`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * `ImageProcessor` 的 sharp（libvips）實作。sharp 是預編譯的原生套件，
 * 平台二進位檔隨 `@img/sharp-*` 選用依賴安裝，不需要編譯環境。
 */
@Injectable()
export class SharpImageProcessor extends ImageProcessor {
  async decode(input: Readable | Buffer, options: DecodeOptions): Promise<DecodedImage> {
    const buffer = Buffer.isBuffer(input) ? input : await readAll(input, options.maxBytes);
    if (buffer.length > options.maxBytes) {
      throw new ImageDecodeError(`影像超過 ${options.maxBytes} 位元組的處理上限`);
    }
    // animated: false —— GIF / 動態 WebP 只取第一格；autoOrient —— 依 EXIF 轉正
    const image = sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
      autoOrient: true,
      failOn: 'error',
    });
    let metadata;
    try {
      metadata = await image.metadata();
    } catch (error) {
      throw new ImageDecodeError('無法解碼影像', { cause: error });
    }
    const width = metadata.autoOrient.width;
    const height = metadata.autoOrient.height;
    if (!width || !height) throw new ImageDecodeError('影像沒有尺寸');
    const info = { width, height, hasAlpha: metadata.hasAlpha };

    return {
      info,
      render: (renderOptions) => render(image.clone(), info.hasAlpha, renderOptions),
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
