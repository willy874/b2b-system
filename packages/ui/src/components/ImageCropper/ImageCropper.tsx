import { cn } from '@b2b-system/web-shared/utils';
import { useCallback, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, Ref } from 'react';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { useControllableState } from '../useControllableState';
import { centeredCrop, moveCrop, normalizeCrop, resizeCrop } from './crop';
import type { CropBounds, CropCorner, ImageCrop } from './crop';

import styles from './ImageCropper.module.css';

export type { CropCorner, ImageCrop } from './crop';

export interface ImageCropperLabels {
  /** 裁切框的名稱（報讀器）。 */
  region: string;
  /** 裁切框的說明：怎麼用鍵盤移動與縮放。 */
  hint: string;
}

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type ImageCropperSlot = 'image' | 'region' | 'handle';

export interface ImageCropperProps extends SlotOverrides<ImageCropperSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  src: string;
  alt: string;
  /**
   * 圖片的自然尺寸（像素）：決定比例與最小尺寸的換算。顯示用的圖可能是縮小版（例：伺服器的預覽），
   * 這時傳原圖的尺寸；省略時用載入後的 `naturalWidth` / `naturalHeight`。
   */
  naturalWidth?: number;
  naturalHeight?: number;
  /** 寬 ÷ 高；有值時裁切框固定這個比例。 */
  aspectRatio?: number;
  /** 裁切框的最小尺寸（自然像素）。 */
  minWidth?: number;
  minHeight?: number;
  /** 以比例（0～1）表示的裁切範圍；省略時取中央最大的範圍。 */
  value?: ImageCrop;
  defaultValue?: ImageCrop;
  onValueChange?: (crop: ImageCrop) => void;
  /** 圓形的參考線（頭像）；裁切的範圍仍是方形。 */
  shape?: 'rect' | 'circle';
  labels?: Partial<ImageCropperLabels>;
  className?: string;
  'data-testid'?: string;
}

const DEFAULT_LABELS: ImageCropperLabels = {
  region: '裁切範圍',
  hint: '方向鍵移動，Shift ＋ 方向鍵縮放',
};

const CORNERS: readonly CropCorner[] = ['nw', 'ne', 'sw', 'se'];
/** 鍵盤每按一次移動或縮放的比例。 */
const KEY_STEP = 0.01;

interface Drag {
  pointerId: number;
  corner: CropCorner | null;
  startX: number;
  startY: number;
  start: ImageCrop;
}

/**
 * 圖片裁切（docs/architecture/frontend/07-ui-system.md §3.18）：拖曳裁切框移動、拖曳四個角縮放，鍵盤也可以操作。
 * 輸出以比例表示的範圍（不重新編碼圖片；套用由伺服器做）。不認識任何業務：頭像的比例與最小尺寸由呼叫端給。
 */
export function ImageCropper({
  ref,
  src,
  alt,
  naturalWidth,
  naturalHeight,
  aspectRatio,
  minWidth,
  minHeight,
  value,
  defaultValue,
  onValueChange,
  shape = 'rect',
  labels: labelOverrides,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: ImageCropperProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const rootRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [loaded, setLoaded] = useState<{ width: number; height: number }>();
  const width = naturalWidth ?? loaded?.width;
  const height = naturalHeight ?? loaded?.height;
  const bounds: CropBounds | undefined =
    width && height
      ? { naturalWidth: width, naturalHeight: height, aspectRatio, minWidth, minHeight }
      : undefined;

  const [raw, setCrop] = useControllableState<ImageCrop | undefined>(
    value,
    defaultValue,
    onValueChange as ((next: ImageCrop | undefined) => void) | undefined,
  );
  const crop = bounds ? normalizeCrop(raw, bounds) : undefined;
  const [drag, setDrag] = useState<Drag>();

  const update = (next: ImageCrop) => setCrop(next);

  const startDrag = (event: PointerEvent<HTMLElement>, corner: CropCorner | null) => {
    if (!crop) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      start: crop,
    });
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;
    const box = rootRef.current?.getBoundingClientRect();
    if (!box?.width || !box.height) return;
    const dx = (event.clientX - drag.startX) / box.width;
    const dy = (event.clientY - drag.startY) / box.height;
    update(
      drag.corner
        ? resizeCrop(drag.start, drag.corner, dx, dy, bounds)
        : moveCrop(drag.start, dx, dy),
    );
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag?.pointerId === event.pointerId) setDrag(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!crop || !bounds) return;
    const delta = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    const [dx = 0, dy = 0] = delta;
    update(event.shiftKey ? resizeCrop(crop, 'se', dx, dy, bounds) : moveCrop(crop, dx, dy));
  };

  // 自己要量裁切框的位移，也要把節點交給呼叫端
  const composedRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <div
      {...rest}
      ref={composedRef}
      className={cn(styles.root, className)}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth && image.naturalHeight) {
            setLoaded({ width: image.naturalWidth, height: image.naturalHeight });
          }
        }}
        {...slot('image', styles.image)}
      />
      {crop && (
        // 裁切框是按鈕：可以聚焦、以方向鍵操作；說明以 aria-describedby 念出
        <button
          type="button"
          aria-label={labels.region}
          aria-describedby={hintId}
          data-shape={shape}
          data-x={crop.x.toFixed(4)}
          data-y={crop.y.toFixed(4)}
          data-width={crop.width.toFixed(4)}
          data-height={crop.height.toFixed(4)}
          onPointerDown={(event) => startDrag(event, null)}
          onKeyDown={onKeyDown}
          {...slot('region', styles.region, {
            testId: 'image-cropper-region',
            style: {
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.width * 100}%`,
              height: `${crop.height * 100}%`,
            },
          })}
        >
          {CORNERS.map((corner) => (
            <span
              key={corner}
              data-corner={corner}
              aria-hidden
              onPointerDown={(event) => startDrag(event, corner)}
              {...slot('handle', styles.handle)}
            />
          ))}
        </button>
      )}
      <span id={hintId} hidden>
        {labels.hint}
      </span>
    </div>
  );
}

export { centeredCrop };
