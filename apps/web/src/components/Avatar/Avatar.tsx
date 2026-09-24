import { Avatar as BaseAvatar } from '@base-ui-components/react/avatar';
import type { Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './Avatar.css';

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type AvatarSlot = 'image' | 'fallback';

export interface AvatarProps extends SlotOverrides<AvatarSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLSpanElement>;
  name: string;
  src?: string;
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
  size = 32,
  className,
  classNames,
  styles,
  testIds,
  ...rest
}: AvatarProps) {
  const slot = createSlots({ classNames, styles, testIds });
  return (
    <BaseAvatar.Root
      className={cn('ge-avatar', className)}
      style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
      {...rest}
    >
      {src && <BaseAvatar.Image src={src} alt={name} {...slot('image', 'ge-avatar__image')} />}
      <BaseAvatar.Fallback {...slot('fallback', 'ge-avatar__fallback')}>
        {initials(name)}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
