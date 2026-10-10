import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeLayout } from '../../testing/fakeLayout';
import { ImageViewer } from './index';
import type { ImageViewerController, ImageViewerProps } from './index';

let fake: ReturnType<typeof installFakeLayout>;

beforeEach(() => {
  fake = installFakeLayout();
  // 容器 800 × 600；原圖 2000 × 1000 → 符合視窗是 0.4，上下各留 100
  fake.setSize('viewer', { clientWidth: 800, clientHeight: 600, width: 800 });
});

afterEach(() => fake.restore());

const LEVELS = [
  { src: '/medium.jpg', width: 800, height: 400 },
  { src: '/large.jpg', width: 2000, height: 1000 },
];

function setup(props: Partial<ImageViewerProps> = {}) {
  return render(
    <ImageViewer
      data-testid="viewer"
      levels={LEVELS}
      width={2000}
      height={1000}
      alt="示意圖"
      {...props}
    />,
  );
}

const root = () => screen.getByTestId('viewer');
const stage = () => screen.getByRole('img', { name: '示意圖' }).parentElement as HTMLElement;
const control = (value: string) =>
  screen
    .getAllByTestId('image-viewer-control')
    .find((node) => node.getAttribute('data-value') === value) as HTMLElement;

const images = () => screen.getAllByTestId('image-viewer-image');

/** 滑鼠從 (fromX, 300) 拖到 (toX, toY) 再放開。 */
function drag(fromX: number, toX: number, toY = 300) {
  fireEvent.pointerDown(root(), {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: fromX,
    clientY: 300,
  });
  fireEvent.pointerMove(root(), {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: toX,
    clientY: toY,
  });
  fireEvent.pointerUp(root(), {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: toX,
    clientY: toY,
  });
}

describe('ImageViewer', () => {
  it('初始符合視窗、置中；第一張載入前有 data-loading', () => {
    const onZoomChange = vi.fn();
    setup({ onZoomChange, placeholderColor: 'var(--color-fill)' });
    expect(stage().style.transform).toBe('translate(0px, 100px) scale(0.4)');
    expect(root()).not.toHaveAttribute('data-zoomed');
    expect(root()).toHaveAttribute('data-loading');
    expect(onZoomChange).toHaveBeenLastCalledWith({ scale: 0.4, fitScale: 0.4, isFit: true });

    const image = screen.getByRole('img', { name: '示意圖' });
    expect(image).toHaveAttribute('src', '/medium.jpg');
    fireEvent.load(image);
    expect(root()).not.toHaveAttribute('data-loading');
  });

  it('解析度載入失敗：以那一層呼叫 onError', () => {
    const onError = vi.fn();
    setup({ onError });
    fireEvent.error(screen.getByRole('img', { name: '示意圖' }));
    expect(onError).toHaveBeenCalledWith(LEVELS[0]);
  });

  it('小圖以原尺寸置中', () => {
    setup({ levels: [{ src: '/small.png', width: 400, height: 300 }], width: 400, height: 300 });
    expect(stage().style.transform).toBe('translate(200px, 150px) scale(1)');
  });

  it('雙擊在符合視窗與 100% 之間切換，以雙擊點為中心', () => {
    const onZoomChange = vi.fn();
    setup({ onZoomChange });
    fireEvent.doubleClick(root(), { clientX: 400, clientY: 300 });
    expect(root()).toHaveAttribute('data-zoomed');
    expect(stage().style.transform).toBe('translate(-600px, -200px) scale(1)');
    expect(onZoomChange).toHaveBeenLastCalledWith({ scale: 1, fitScale: 0.4, isFit: false });

    fireEvent.doubleClick(root(), { clientX: 100, clientY: 100 });
    expect(root()).not.toHaveAttribute('data-zoomed');
    expect(stage().style.transform).toBe('translate(0px, 100px) scale(0.4)');
  });

  it('漸進載入：放大後在背景載入大圖，載好才換上，縮回也不換回小的', () => {
    setup();
    fireEvent.load(screen.getByRole('img', { name: '示意圖' }));
    fireEvent.doubleClick(root(), { clientX: 400, clientY: 300 });

    expect(images()).toHaveLength(2);
    const pending = images().find((node) => node.hasAttribute('data-pending')) as HTMLElement;
    expect(pending).toHaveAttribute('src', '/large.jpg');
    expect(pending).toHaveAttribute('alt', '');
    // 還沒載好：小圖仍是看得到的那張
    expect(screen.getByRole('img', { name: '示意圖' })).toHaveAttribute('src', '/medium.jpg');

    fireEvent.load(pending);
    expect(images()).toHaveLength(1);
    expect(images()[0]).toBe(pending);
    expect(pending).not.toHaveAttribute('data-pending');
    expect(pending).toHaveAttribute('alt', '示意圖');

    fireEvent.doubleClick(root(), { clientX: 400, clientY: 300 });
    expect(images()).toHaveLength(1);
    expect(images()[0]).toHaveAttribute('src', '/large.jpg');
  });

  it('控制按鈕：放大、縮小、符合視窗；符合視窗時第三顆是「實際大小」', () => {
    setup();
    expect(control('zoomOut')).toBeDisabled();
    expect(control('actualSize')).toHaveAccessibleName('實際大小');

    fireEvent.click(control('zoomIn'));
    expect(root()).toHaveAttribute('data-zoomed');
    expect(stage().style.transform).toContain('scale(0.6');

    fireEvent.click(control('zoomOut'));
    expect(root()).not.toHaveAttribute('data-zoomed');

    fireEvent.click(control('actualSize'));
    expect(stage().style.transform).toContain('scale(1)');
    fireEvent.click(control('fit'));
    expect(root()).not.toHaveAttribute('data-zoomed');
  });

  it('labels 換掉按鈕名稱；showControls={false} 不顯示按鈕', () => {
    const { unmount } = setup({ labels: { zoomIn: 'Zoom in' } });
    expect(control('zoomIn')).toHaveAccessibleName('Zoom in');
    unmount();
    setup({ showControls: false });
    expect(screen.queryByTestId('image-viewer-controls')).not.toBeInTheDocument();
  });

  it('符合視窗時水平拖曳超過門檻放開：onSwipe', () => {
    const onSwipe = vi.fn();
    setup({ onSwipe });
    drag(400, 300);
    expect(onSwipe).toHaveBeenLastCalledWith('next');
    drag(300, 400);
    expect(onSwipe).toHaveBeenLastCalledWith('previous');
    // 不到門檻、或垂直位移較大：不算
    drag(400, 360);
    drag(400, 300, 500);
    expect(onSwipe).toHaveBeenCalledTimes(2);
  });

  it('放大時拖曳是平移，不呼叫 onSwipe', () => {
    const onSwipe = vi.fn();
    setup({ onSwipe });
    fireEvent.doubleClick(root(), { clientX: 400, clientY: 300 });
    fireEvent.pointerDown(root(), {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 400,
      clientY: 300,
    });
    fireEvent.pointerMove(root(), {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 300,
      clientY: 250,
    });
    fireEvent.pointerUp(root(), { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 250 });
    expect(stage().style.transform).toBe('translate(-700px, -250px) scale(1)');
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('觸控雙指縮放：以兩指的中點為中心', () => {
    setup();
    const touch = { pointerType: 'touch' };
    fireEvent.pointerDown(root(), { ...touch, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerDown(root(), { ...touch, pointerId: 2, clientX: 500, clientY: 300 });
    // 距離 200 → 400：兩倍；中點從 400 移到 500，同時平移 100
    fireEvent.pointerMove(root(), { ...touch, pointerId: 2, clientX: 700, clientY: 300 });
    expect(root()).toHaveAttribute('data-zoomed');
    expect(stage().style.transform).toBe('translate(-300px, -100px) scale(0.8)');
    fireEvent.pointerUp(root(), { ...touch, pointerId: 2, clientX: 700, clientY: 300 });
    fireEvent.pointerUp(root(), { ...touch, pointerId: 1, clientX: 300, clientY: 300 });
    expect(root()).not.toHaveAttribute('data-gesture');
  });

  it('滾輪以游標為中心縮放', () => {
    setup();
    fireEvent.wheel(root(), { deltaY: -200, clientX: 400, clientY: 300 });
    expect(root()).toHaveAttribute('data-zoomed');
    fireEvent.wheel(root(), { deltaY: 10_000, clientX: 400, clientY: 300 });
    expect(root()).not.toHaveAttribute('data-zoomed');
  });

  it('controllerRef 提供 zoomIn／zoomOut／fit／actualSize／toggle', () => {
    const controllerRef = createRef<ImageViewerController>();
    setup({ controllerRef });
    act(() => controllerRef.current?.toggle());
    expect(stage().style.transform).toContain('scale(1)');
    act(() => controllerRef.current?.fit());
    expect(root()).not.toHaveAttribute('data-zoomed');
    act(() => controllerRef.current?.zoomIn());
    act(() => controllerRef.current?.zoomIn());
    expect(stage().style.transform).toContain('scale(0.9');
    act(() => controllerRef.current?.zoomOut());
    expect(stage().style.transform).toContain('scale(0.6');
    act(() => controllerRef.current?.actualSize());
    expect(stage().style.transform).toContain('scale(1)');
  });

  it('ref、className、data-testid 透傳到根元素；testIds 換掉內層的 testid', () => {
    const ref = createRef<HTMLDivElement>();
    setup({ ref, className: 'custom', testIds: { image: 'picture', controls: 'tools' } });
    expect(ref.current).toBe(root());
    expect(root()).toHaveClass('custom');
    expect(screen.getByTestId('picture')).toHaveAttribute('src', '/medium.jpg');
    expect(screen.getByTestId('tools')).toBeInTheDocument();
  });
});
