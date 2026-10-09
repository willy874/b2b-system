import { useEffect, useRef } from 'react';

import { decodeBlurHash } from '../blurhash';

/** 解碼的大小：BlurHash 只有幾個低頻分量，32 × 32 放大之後與原尺寸看不出差別。 */
const DECODE_SIZE = 32;

interface GalleryPlaceholderProps {
  /** BlurHash；沒有時只有主色。 */
  hash: string | null;
  className?: string;
}

/** 圖片載入前的模糊預覽：掛上時才解碼（格子在可視範圍內才會被渲染）。 */
export function GalleryPlaceholder({ hash, className }: GalleryPlaceholderProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!hash || !element) return;
    const pixels = decodeBlurHash(hash, DECODE_SIZE, DECODE_SIZE);
    const context = element.getContext?.('2d');
    if (!pixels || !context) return;
    context.putImageData(new ImageData(pixels, DECODE_SIZE, DECODE_SIZE), 0, 0);
  }, [hash]);
  if (!hash) return null;
  return (
    <canvas
      ref={canvas}
      width={DECODE_SIZE}
      height={DECODE_SIZE}
      aria-hidden
      className={className}
      data-testid="gallery-placeholder"
    />
  );
}
