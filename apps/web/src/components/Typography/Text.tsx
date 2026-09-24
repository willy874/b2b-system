import { Typography } from './Typography';
import type { TypographyProps } from './Typography';

export type TextSize = 'md' | 'sm';

export interface TextProps extends Omit<TypographyProps, 'variant'> {
  /** `sm` 為輔助說明的字級，預設淡化色調。 */
  size?: TextSize;
  /** 等寬字並加外框，用於代碼、識別碼；優先於 `size`。 */
  code?: boolean;
}

/** 行內文字，預設渲染成 `span`。 */
export function Text({ size = 'md', code, as = 'span', ...rest }: TextProps) {
  const variant = code ? 'code' : size === 'sm' ? 'caption' : 'body';
  return <Typography variant={variant} as={as} {...rest} />;
}
