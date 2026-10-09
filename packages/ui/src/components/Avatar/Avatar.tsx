import { cn } from '@b2b-system/web-shared/utils';
import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import type { ReactNode, Ref } from 'react';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Avatar.module.css';

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type AvatarSlot = 'image' | 'fallback';

export interface AvatarProps extends SlotOverrides<AvatarSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLSpanElement>;
  name: string;
  /** 單一網址的圖片；載入失敗時退回名字縮寫。 */
  src?: string;
  /**
   * 呼叫端自己渲染的圖片（例：`web-core/image` 的 `SignedImage`，有多種格式與效期），疊在名字縮寫之上、填滿圓形。
   * 圖片還沒載入或失敗時呼叫端不畫任何東西，縮寫就露出來。與 `src` 擇一。
   */
  image?: ReactNode;
  size?: number;
  className?: string;
  'data-testid'?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
}

export function Avatar({
  name,
  src,
  image,
  size = 32,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: AvatarProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseAvatar.Root
      className={cn(styles.root, className)}
      style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
      {...rest}
    >
      {src && <BaseAvatar.Image src={src} alt={name} {...slot('image', styles.image)} />}
      <BaseAvatar.Fallback {...slot('fallback')}>{initials(name)}</BaseAvatar.Fallback>
      {!src && image && <span {...slot('image', styles.layer)}>{image}</span>}
    </BaseAvatar.Root>
  );
}
