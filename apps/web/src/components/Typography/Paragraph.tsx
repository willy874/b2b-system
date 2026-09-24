import { Typography } from './Typography';
import type { TypographyProps } from './Typography';

export type ParagraphSize = 'md' | 'sm';

export interface ParagraphProps extends Omit<TypographyProps, 'variant'> {
  /** `sm` 為輔助說明的字級，預設淡化色調。 */
  size?: ParagraphSize;
}

/** 段落，預設渲染成 `p`。 */
export function Paragraph({ size = 'md', as = 'p', ...rest }: ParagraphProps) {
  return <Typography variant={size === 'sm' ? 'caption' : 'body'} as={as} {...rest} />;
}
