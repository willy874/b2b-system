import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { centeredCrop, moveCrop, normalizeCrop, resizeCrop } from './crop';
import { ImageCropper } from './index';

const SQUARE_ON_WIDE = { naturalWidth: 400, naturalHeight: 200, aspectRatio: 1 };

describe('裁切的幾何（比例，0～1）', () => {
  it('centeredCrop：有比例時取中央最大的範圍；沒有比例時整張', () => {
    expect(centeredCrop(SQUARE_ON_WIDE)).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(centeredCrop({ naturalWidth: 400, naturalHeight: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('moveCrop：不超出圖片', () => {
    expect(moveCrop({ x: 0.25, y: 0, width: 0.5, height: 1 }, 0.5, 0.3)).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });

  it('resizeCrop：對角固定；有比例時高跟著寬；不小於最小尺寸、不超出圖片', () => {
    const start = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const smaller = resizeCrop(start, 'se', -0.25, 0, SQUARE_ON_WIDE);
    expect(smaller).toEqual({ x: 0.25, y: 0, width: 0.25, height: 0.5 });
    // 往外拉也放不下比圖高更大的正方形
    expect(resizeCrop(smaller, 'se', 0.5, 0, SQUARE_ON_WIDE)).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
    // 最小 100 px：寬至少 0.25
    expect(resizeCrop(start, 'nw', 0.45, 0, { ...SQUARE_ON_WIDE, minWidth: 100 })).toMatchObject({
      width: 0.25,
      height: 0.5,
      x: 0.5,
      y: 0.5,
    });
  });

  it('normalizeCrop：比例不符或沒給時取中央', () => {
    expect(normalizeCrop({ x: 0, y: 0, width: 1, height: 1 }, SQUARE_ON_WIDE)).toEqual(
      centeredCrop(SQUARE_ON_WIDE),
    );
    expect(normalizeCrop(undefined, SQUARE_ON_WIDE)).toEqual(centeredCrop(SQUARE_ON_WIDE));
  });
});

describe('ImageCropper', () => {
  it('知道自然尺寸時顯示裁切框（預設中央、照比例）', () => {
    render(<ImageCropper src="/a.png" alt="a" {...SQUARE_ON_WIDE} />);
    const region = screen.getByRole('button', { name: '裁切範圍' });
    expect(region).toHaveAttribute('data-x', '0.2500');
    expect(region).toHaveAttribute('data-width', '0.5000');
    expect(region).toHaveStyle({ left: '25%', width: '50%' });
  });

  it('不知道自然尺寸時等圖片載入後才顯示裁切框', () => {
    render(<ImageCropper src="/a.png" alt="a" aspectRatio={1} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const image = screen.getByRole('img', { name: 'a' });
    Object.defineProperty(image, 'naturalWidth', { value: 400 });
    Object.defineProperty(image, 'naturalHeight', { value: 200 });
    fireEvent.load(image);
    expect(screen.getByRole('button')).toHaveAttribute('data-width', '0.5000');
  });

  it('方向鍵移動、Shift ＋ 方向鍵縮放，都通知 onValueChange', () => {
    const onValueChange = vi.fn();
    render(
      <ImageCropper
        src="/a.png"
        alt="a"
        {...SQUARE_ON_WIDE}
        defaultValue={{ x: 0.25, y: 0, width: 0.5, height: 1 }}
        onValueChange={onValueChange}
      />,
    );
    const region = screen.getByRole('button');
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(onValueChange).toHaveBeenLastCalledWith({ x: 0.24, y: 0, width: 0.5, height: 1 });
    fireEvent.keyDown(region, { key: 'ArrowLeft', shiftKey: true });
    const [last] = onValueChange.mock.lastCall ?? [];
    expect(last.width).toBeCloseTo(0.49);
    expect(last.height).toBeCloseTo(0.98);
  });

  it('受控：顯示傳入的值', () => {
    render(
      <ImageCropper
        src="/a.png"
        alt="a"
        {...SQUARE_ON_WIDE}
        value={{ x: 0.1, y: 0.2, width: 0.4, height: 0.8 }}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('data-x', '0.1000');
  });

  it('ref、className、data-testid 透傳到根元素；圓形參考線以 data-shape 表示', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ImageCropper
        ref={ref}
        src="/a.png"
        alt="a"
        {...SQUARE_ON_WIDE}
        shape="circle"
        className="custom"
        data-testid="cropper"
      />,
    );
    expect(ref.current).toBe(screen.getByTestId('cropper'));
    expect(screen.getByTestId('cropper')).toHaveClass('custom');
    expect(screen.getByTestId('image-cropper-region')).toHaveAttribute('data-shape', 'circle');
  });
});
