import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ImageViewer } from './ImageViewer';
import type { ImageViewerLevel } from './ImageViewer';

/**
 * 佔位圖：以原圖座標畫格線與文字（只用預設的黑色與透明度，不寫色碼），
 * 文字標出是哪一個解析度，放大時看得出換成了大圖。
 */
function placeholderSvg(width: number, height: number, label: string): string {
  const step = 100;
  const lines: string[] = [];
  for (let x = step; x < width; x += step) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" />`);
  }
  for (let y = step; y < height; y += step) {
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" />`);
  }
  const fontSize = Math.round(Math.min(width, height) / 10);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill-opacity="0.06" />`,
    `<g stroke="currentColor" stroke-opacity="0.2" stroke-width="2">${lines.join('')}</g>`,
    `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill-opacity="0.12" />`,
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${fontSize}" fill-opacity="0.6">${label}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 同一張圖的多個解析度：內容以原圖座標畫，只有標籤不同。 */
function levelsFor(width: number, height: number, widths: readonly number[]): ImageViewerLevel[] {
  return widths.map((levelWidth) => ({
    src: placeholderSvg(width, height, `${levelWidth} px`),
    width: levelWidth,
    height: Math.round((height / width) * levelWidth),
  }));
}

const meta = {
  title: 'Components/ImageViewer',
  component: ImageViewer,
  args: {
    levels: levelsFor(2400, 1600, [800, 2400]),
    width: 2400,
    height: 1600,
    alt: '示意圖',
    placeholderColor: 'var(--color-fill)',
    maxZoom: 4,
    showControls: true,
    onZoomChange: fn(),
    onSwipe: fn(),
    style: { height: 480 },
  },
} satisfies Meta<typeof ImageViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 滾輪或觸控板縮放、拖曳平移、雙擊切換；放大到需要時換成 2400 px 的那張。 */
export const Playground: Story = {};

/** 比容器小的圖：以原尺寸置中，雙擊放大兩倍。 */
export const SmallImage: Story = {
  args: {
    levels: levelsFor(400, 300, [400]),
    width: 400,
    height: 300,
  },
};

/** 直式圖：以高度符合視窗。 */
export const Portrait: Story = {
  args: {
    levels: levelsFor(1200, 2000, [600, 1200]),
    width: 1200,
    height: 2000,
  },
};
