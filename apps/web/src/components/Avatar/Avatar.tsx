import { Avatar as BaseAvatar } from '@base-ui-components/react/avatar';
import type { Ref } from 'react';

import { cn } from '@/shared/utils';

import './Avatar.css';

export interface AvatarProps {
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

export function Avatar({ name, src, size = 32, className, ...rest }: AvatarProps) {
  return (
    <BaseAvatar.Root
      className={cn('ge-avatar', className)}
      style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
      {...rest}
    >
      {src && <BaseAvatar.Image src={src} alt={name} className="ge-avatar__image" />}
      <BaseAvatar.Fallback className="ge-avatar__fallback">{initials(name)}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
