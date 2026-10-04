import type { CSSProperties, Ref } from 'react';

import { cn } from '@/shared/utils';

import { ICONS } from './icons';
import type { IconName } from './icons';

import styles from './Icon.module.css';

export type IconSize = 14 | 16 | 20 | 24;

export interface IconProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<SVGSVGElement>;
  name: IconName;
  size?: IconSize;
  className?: string;
  style?: CSSProperties;
  /** 純裝飾時留空（預設 aria-hidden）；有語意時才給。 */
  'aria-label'?: string;
  'data-testid'?: string;
}

/** 統一尺寸與 `currentColor` 著色；顏色由呼叫端的文字顏色決定。 */
export function Icon({ name, size = 20, className, ...rest }: IconProps) {
  const Svg = ICONS[name];
  const label = rest['aria-label'];
  return (
    <Svg
      className={cn(styles.root, className)}
      width={size}
      height={size}
      focusable="false"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      {...rest}
    />
  );
}
