import { cn } from '@b2b-system/web-shared/utils';
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent, Ref } from 'react';

import { IconButton } from '../Button';
import { Icon } from '../Icon';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { useElementSize } from '../useElementSize';
import { useLatestRef } from '../useLatestRef';
import { clampOffset, fitScale, fitState, pickLevel, zoomAt } from './zoom';
import type { ViewerPoint, ViewerSize, ViewerState, ZoomBounds } from './zoom';

import styles from './ImageViewer.module.css';

/** 一個解析度的來源。`width` / `height` 是這個檔案的像素尺寸（`pickLevel` 以寬度挑選）。 */
export interface ImageViewerLevel {
  src: string;
  width: number;
  height: number;
  srcSet?: string;
  /** 依格式協商的來源（例：AVIF、WebP），渲染成 `<picture>` 的 `<source>`。 */
  sources?: readonly { type: string; srcSet: string }[];
}

/** `controllerRef` 拿到的控制方法（快捷鍵由呼叫端綁）。 */
export interface ImageViewerController {
  zoomIn(): void;
  zoomOut(): void;
  /** 符合視窗。 */
  fit(): void;
  /** 100%。 */
  actualSize(): void;
  /** 在「符合視窗」與「100%」之間切換（與雙擊相同，以容器中央為中心）。 */
  toggle(): void;
}

/** `onZoomChange` 收到的狀態。 */
export interface ImageViewerZoomState {
  /** 相對於原圖的縮放（1 ＝ 100%）。 */
  scale: number;
  /** 符合視窗時的縮放。 */
  fitScale: number;
  isFit: boolean;
}

/** 控制按鈕的名稱（報讀器與提示）。 */
export interface ImageViewerLabels {
  zoomIn: string;
  zoomOut: string;
  fit: string;
  actualSize: string;
}

/**
 * `className` / `style` / `data-testid` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫：
 * `stage` 是套用 transform 的那一層，`image` 是每個解析度的 `<img>`，`controls` 是右下角的按鈕列。
 */
export type ImageViewerSlot = 'stage' | 'image' | 'controls';

export interface ImageViewerProps extends SlotOverrides<ImageViewerSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 控制方法；與 `ref`（DOM 節點）分開。 */
  controllerRef?: Ref<ImageViewerController>;
  /** 由小到大的解析度；第一個先顯示（通常已在快取），放大到需要時才換成更大的那個（漸進載入）。 */
  levels: readonly ImageViewerLevel[];
  /** 原圖尺寸（決定「100%」與最大縮放）。 */
  width: number;
  height: number;
  alt: string;
  /** 載入前的背景（資料，例：主色）；只套 inline style。 */
  placeholderColor?: string;
  /** 載入前的模糊預覽（例：BlurHash 解出來的 data URL）。 */
  placeholderSrc?: string;
  /** 最大縮放，相對於 100% 的倍數；預設 4。 */
  maxZoom?: number;
  onZoomChange?: (state: ImageViewerZoomState) => void;
  /** 在「符合視窗」時左右滑（觸控）或拖曳超過門檻：交給呼叫端切換上一張／下一張。 */
  onSwipe?: (direction: 'previous' | 'next') => void;
  /** 某個解析度載入失敗（例：簽章網址過期）：交給呼叫端重抓網址，換了 `levels` 就重新載入。 */
  onError?: (level: ImageViewerLevel) => void;
  labels?: Partial<ImageViewerLabels>;
  /** 右下角的放大、縮小、符合視窗按鈕；預設 true。 */
  showControls?: boolean;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'data-testid'?: string;
}

const DEFAULT_LABELS: ImageViewerLabels = {
  zoomIn: '放大',
  zoomOut: '縮小',
  fit: '符合視窗',
  actualSize: '實際大小',
};

/** 按鈕與快捷鍵每次縮放的倍數。 */
const ZOOM_STEP = 1.5;
/** 滾輪每個像素的縮放速度；觸控板雙指縮放（`ctrlKey` 的 wheel）的 delta 小得多，速度要快。 */
const WHEEL_SPEED = 0.0015;
const PINCH_WHEEL_SPEED = 0.01;
/** 符合視窗時水平拖曳超過這個距離（px）放開就是切換上一張／下一張。 */
const SWIPE_THRESHOLD = 60;
/** 觸控的雙擊：兩次點擊的間隔（ms）與距離（px）。 */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 30;
/** 點擊與拖曳的分界（px）。 */
const TAP_SLOP = 10;
/** 縮放與「符合視窗」相差在這之內視為符合視窗。 */
const FIT_EPSILON = 1e-3;
/** 小圖（符合視窗就是 100%）雙擊時放大的倍數。 */
const SMALL_IMAGE_TOGGLE_SCALE = 2;

type Gesture =
  | { kind: 'pan'; pointerId: number; start: ViewerPoint; startView: ViewerState }
  | { kind: 'swipe'; pointerId: number; start: ViewerPoint; last: ViewerPoint; pointerType: string }
  | { kind: 'pinch'; startDistance: number; startMid: ViewerPoint; startView: ViewerState };

function distance(a: ViewerPoint, b: ViewerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: ViewerPoint, b: ViewerPoint): ViewerPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * 可縮放與平移的單張圖片（docs/architecture/frontend/07-ui-system.md §3.20）：滾輪與觸控板以游標為中心縮放、拖曳平移、
 * 雙擊在「符合視窗」與「100%」之間切換、觸控雙指縮放；符合視窗時左右滑交給 `onSwipe`。
 * 依顯示的像素挑解析度，在背景載入更大的那張，載好才換上（不閃爍、不換回小的）。
 * 上一張／下一張、底片列、資訊面板由呼叫端組合；根元素的大小由呼叫端決定。
 */
export function ImageViewer({
  ref,
  controllerRef,
  levels,
  width,
  height,
  alt,
  placeholderColor,
  placeholderSrc,
  maxZoom = 4,
  onZoomChange,
  onSwipe,
  onError,
  labels: labelOverrides,
  showControls = true,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: ImageViewerProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const composedRef = useCallback(
    (element: HTMLDivElement | null) => {
      setRoot(element);
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );
  const container = useElementSize(root);
  const isMeasured = container.width > 0 && container.height > 0;
  const image: ViewerSize = { width, height };

  // 換了一張圖：回到符合視窗、從第一個解析度重新開始（render 期間依 prop 調整 state）
  const imageKey = `${levels[0]?.src ?? ''}|${width}|${height}`;
  const [trackedKey, setTrackedKey] = useState(imageKey);
  /** null 表示「符合視窗」：容器尺寸改變時跟著重算。 */
  const [view, setView] = useState<ViewerState | null>(null);
  const [displayLevel, setDisplayLevel] = useState(0);
  const [requestedLevel, setRequestedLevel] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  if (trackedKey !== imageKey) {
    setTrackedKey(imageKey);
    setView(null);
    setDisplayLevel(0);
    setRequestedLevel(0);
    setIsLoaded(false);
  }

  const [isGesturing, setIsGesturing] = useState(false);
  const [isAnimated, setIsAnimated] = useState(false);

  const fit = fitScale(image, container);
  const bounds: ZoomBounds = {
    image,
    container,
    minScale: fit,
    maxScale: Math.max(fit, maxZoom),
  };
  // 放大狀態在容器變小時仍不能小於新的符合視窗，平移也要重新限制
  const current: ViewerState = view
    ? clampOffset({ ...view, scale: Math.max(view.scale, fit) }, image, container)
    : fitState(image, container);
  const isFit = Math.abs(current.scale - fit) < FIT_EPSILON;
  const isMax = current.scale >= bounds.maxScale - FIT_EPSILON;

  const commit = (next: ViewerState) => {
    setView(Math.abs(next.scale - fit) < FIT_EPSILON ? null : next);
  };
  const center: ViewerPoint = { x: container.width / 2, y: container.height / 2 };
  const zoomBy = (factor: number, point: ViewerPoint, animate: boolean) => {
    if (!isMeasured) return;
    setIsAnimated(animate);
    commit(zoomAt(current, factor, point, bounds));
  };
  const scaleTo = (scale: number, point: ViewerPoint) => zoomBy(scale / current.scale, point, true);
  const toFit = () => {
    setIsAnimated(true);
    setView(null);
  };
  const toggleAt = (point: ViewerPoint) => {
    if (!isFit) toFit();
    else scaleTo(fit < 1 ? 1 : Math.min(bounds.maxScale, SMALL_IMAGE_TOGGLE_SCALE), point);
  };

  const controller: ImageViewerController = {
    zoomIn: () => zoomBy(ZOOM_STEP, center, true),
    zoomOut: () => zoomBy(1 / ZOOM_STEP, center, true),
    fit: toFit,
    actualSize: () => scaleTo(1, center),
    toggle: () => toggleAt(center),
  };
  const latestController = useLatestRef(controller);
  useImperativeHandle(
    controllerRef,
    () => ({
      zoomIn: () => latestController.current.zoomIn(),
      zoomOut: () => latestController.current.zoomOut(),
      fit: () => latestController.current.fit(),
      actualSize: () => latestController.current.actualSize(),
      toggle: () => latestController.current.toggle(),
    }),
    [latestController],
  );

  const onZoomChangeRef = useLatestRef(onZoomChange);
  useEffect(() => {
    if (isMeasured) onZoomChangeRef.current?.({ scale: current.scale, fitScale: fit, isFit });
  }, [isMeasured, current.scale, fit, isFit, onZoomChangeRef]);

  // 漸進載入：需要更大的解析度時記下來（只增不減），由隱藏的那一層在背景載入
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const neededLevel = isMeasured ? pickLevel(levels, width * current.scale, dpr) : 0;
  if (neededLevel > requestedLevel) setRequestedLevel(neededLevel);
  const pendingLevel =
    requestedLevel > displayLevel && requestedLevel < levels.length ? requestedLevel : undefined;

  // 滾輪：React 的 onWheel 是 passive，不能 preventDefault，改掛原生事件
  const wheel = useLatestRef((event: WheelEvent) => {
    if (!root) return;
    event.preventDefault();
    const box = root.getBoundingClientRect();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.height : 1;
    const speed = event.ctrlKey ? PINCH_WHEEL_SPEED : WHEEL_SPEED;
    zoomBy(
      Math.exp(-event.deltaY * unit * speed),
      { x: event.clientX - box.left, y: event.clientY - box.top },
      false,
    );
  });
  useEffect(() => {
    if (!root) return undefined;
    const listener = (event: WheelEvent) => wheel.current(event);
    root.addEventListener('wheel', listener, { passive: false });
    return () => root.removeEventListener('wheel', listener);
  }, [root, wheel]);

  const pointers = useRef(new Map<number, ViewerPoint>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ time: number; point: ViewerPoint } | null>(null);
  const lastPointerType = useRef<string>('mouse');

  const toLocal = (clientX: number, clientY: number): ViewerPoint => {
    const box = root?.getBoundingClientRect();
    return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
  };

  const startSinglePointer = (pointerId: number, point: ViewerPoint, pointerType: string) => {
    gesture.current = isFit
      ? { kind: 'swipe', pointerId, start: point, last: point, pointerType }
      : { kind: 'pan', pointerId, start: point, startView: current };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    lastPointerType.current = event.pointerType;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = toLocal(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    setIsAnimated(false);
    setIsGesturing(true);
    const [first, second] = [...pointers.current.values()];
    if (first && second) {
      gesture.current = {
        kind: 'pinch',
        startDistance: distance(first, second),
        startMid: midpoint(first, second),
        startView: current,
      };
    } else {
      startSinglePointer(event.pointerId, point, event.pointerType);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = toLocal(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    const active = gesture.current;
    if (!active) return;
    if (active.kind === 'pinch') {
      const [first, second] = [...pointers.current.values()];
      if (!first || !second || active.startDistance <= 0) return;
      const mid = midpoint(first, second);
      const zoomed = zoomAt(
        active.startView,
        distance(first, second) / active.startDistance,
        active.startMid,
        bounds,
      );
      // 兩指一起移動時也跟著平移
      commit(
        clampOffset(
          {
            ...zoomed,
            x: zoomed.x + mid.x - active.startMid.x,
            y: zoomed.y + mid.y - active.startMid.y,
          },
          image,
          container,
        ),
      );
    } else if (active.pointerId === event.pointerId) {
      if (active.kind === 'pan') {
        commit(
          clampOffset(
            {
              scale: active.startView.scale,
              x: active.startView.x + point.x - active.start.x,
              y: active.startView.y + point.y - active.start.y,
            },
            image,
            container,
          ),
        );
      } else {
        active.last = point;
      }
    }
  };

  const detectDoubleTap = (point: ViewerPoint) => {
    const now = Date.now();
    const previous = lastTap.current;
    if (
      previous &&
      now - previous.time < DOUBLE_TAP_MS &&
      distance(previous.point, point) < DOUBLE_TAP_DISTANCE
    ) {
      lastTap.current = null;
      toggleAt(point);
    } else {
      lastTap.current = { time: now, point };
    }
  };

  const finishSwipe = (active: Extract<Gesture, { kind: 'swipe' }>, cancelled: boolean) => {
    const dx = active.last.x - active.start.x;
    const dy = active.last.y - active.start.y;
    if (cancelled) return;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dy) < Math.abs(dx)) {
      onSwipe?.(dx < 0 ? 'next' : 'previous');
      return;
    }
    // 觸控沒有可靠的 dblclick：自己判斷雙擊
    if (active.pointerType !== 'touch' || Math.hypot(dx, dy) > TAP_SLOP) return;
    detectDoubleTap(active.last);
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const lastPoint = pointers.current.get(event.pointerId);
    if (!lastPoint) return;
    pointers.current.delete(event.pointerId);
    const active = gesture.current;
    if (active?.kind === 'swipe' && active.pointerId === event.pointerId) {
      finishSwipe(active, cancelled);
    } else if (
      active?.kind === 'pan' &&
      active.pointerId === event.pointerId &&
      !cancelled &&
      event.pointerType === 'touch' &&
      distance(lastPoint, active.start) <= TAP_SLOP
    ) {
      detectDoubleTap(active.start);
    }
    const [remainingId] = [...pointers.current.keys()];
    const remaining = remainingId === undefined ? undefined : pointers.current.get(remainingId);
    if (remainingId !== undefined && remaining) {
      // 雙指放開一指：剩下的那一指接著平移（不當成滑動）
      gesture.current = isFit
        ? null
        : { kind: 'pan', pointerId: remainingId, start: remaining, startView: current };
    } else {
      gesture.current = null;
      setIsGesturing(false);
    }
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    // 觸控的雙擊已在 pointerup 處理；部分瀏覽器另外送出的 dblclick 不再切換一次
    if (lastPointerType.current === 'touch') return;
    toggleAt(toLocal(event.clientX, event.clientY));
  };

  const stageSlot = slot('stage', styles.stage, {
    style: {
      width,
      height,
      transform: `translate(${current.x}px, ${current.y}px) scale(${current.scale})`,
      backgroundColor: isLoaded ? undefined : placeholderColor,
    },
  });

  const imageSlot = slot('image', styles.image, { testId: 'image-viewer-image' });
  const renderLevel = (index: number) => {
    const level = levels[index];
    if (!level) return null;
    const isPending = index !== displayLevel;
    const img = (
      <img
        // 沒有 <picture> 時 key 落在 <img> 上：換成大圖時同一個節點留著，不會重新載入
        key={index}
        src={level.src}
        srcSet={level.srcSet}
        alt={isPending ? '' : alt}
        aria-hidden={isPending || undefined}
        width={level.width}
        height={level.height}
        draggable={false}
        decoding="async"
        data-level={index}
        data-pending={isPending || undefined}
        onLoad={() => {
          // 大圖載好才換上；之前那張一直留著，所以沒有空白的瞬間
          if (index > displayLevel) setDisplayLevel(index);
          setIsLoaded(true);
        }}
        onError={() => onError?.(level)}
        {...imageSlot}
      />
    );
    if (!level.sources?.length) return img;
    return (
      <picture key={index} className={styles.picture}>
        {level.sources.map((source) => (
          <source key={source.type} type={source.type} srcSet={source.srcSet} />
        ))}
        {img}
      </picture>
    );
  };
  const shownLevel = Math.max(0, Math.min(displayLevel, levels.length - 1));
  const layers = pendingLevel === undefined ? [shownLevel] : [shownLevel, pendingLevel];

  return (
    <div
      {...rest}
      ref={composedRef}
      className={cn(styles.root, className)}
      data-zoomed={(isMeasured && !isFit) || undefined}
      data-loading={!isLoaded || undefined}
      data-gesture={isGesturing || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endPointer(event, false)}
      onPointerCancel={(event) => endPointer(event, true)}
      onDoubleClick={onDoubleClick}
    >
      <div
        {...stageSlot}
        data-animate={isAnimated || undefined}
        data-measured={isMeasured || undefined}
      >
        {!isLoaded && placeholderSrc && (
          <img src={placeholderSrc} alt="" aria-hidden className={styles.placeholder} />
        )}
        {layers.map(renderLevel)}
      </div>
      {showControls && (
        <div
          {...slot('controls', styles.controls, { testId: 'image-viewer-controls' })}
          // 按鈕上的按下與雙擊不是在操作圖片
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <IconButton
            size="sm"
            aria-label={labels.zoomIn}
            title={labels.zoomIn}
            data-testid="image-viewer-control"
            data-value="zoomIn"
            disabled={!isMeasured || isMax}
            onClick={controller.zoomIn}
          >
            <Icon name="zoom-in" size={16} />
          </IconButton>
          <IconButton
            size="sm"
            aria-label={labels.zoomOut}
            title={labels.zoomOut}
            data-testid="image-viewer-control"
            data-value="zoomOut"
            disabled={!isMeasured || isFit}
            onClick={controller.zoomOut}
          >
            <Icon name="zoom-out" size={16} />
          </IconButton>
          {/* 符合視窗時這顆是「實際大小」，放大後是「符合視窗」 */}
          <IconButton
            size="sm"
            aria-label={isFit ? labels.actualSize : labels.fit}
            title={isFit ? labels.actualSize : labels.fit}
            data-testid="image-viewer-control"
            data-value={isFit ? 'actualSize' : 'fit'}
            disabled={!isMeasured || (isFit && fit >= 1)}
            onClick={isFit ? controller.actualSize : controller.fit}
          >
            <Icon name="maximize" size={16} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
