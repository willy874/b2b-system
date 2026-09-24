import type { ElementType } from 'react';

import { Typography } from './Typography';
import type { TypographyProps, TypographyVariant } from './Typography';

export type TitleLevel = 1 | 2 | 3;

const TITLE_VARIANT = {
  1: 'pageTitle',
  2: 'sectionTitle',
  3: 'bodyStrong',
} as const satisfies Record<TitleLevel, TypographyVariant>;

const TITLE_TAG = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
} as const satisfies Record<TitleLevel, ElementType>;

export interface TitleProps extends Omit<TypographyProps, 'variant' | 'strong'> {
  /** 1：頁面標題、2：區塊標題、3：小節標題；預設渲染成對應的 `h1`～`h3`。 */
  level?: TitleLevel;
}

/** 標題。外觀由 `level` 決定，實際標籤可用 `as` 覆寫。 */
export function Title({ level = 1, as, ...rest }: TitleProps) {
  return <Typography variant={TITLE_VARIANT[level]} as={as ?? TITLE_TAG[level]} {...rest} />;
}
