import { Link } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { useRouteLinkResolver } from './hooks';
import type { RouteLinkParams } from './registry';

const NO_PARAMS: RouteLinkParams = {};

interface RouteLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** route id，例：`user.detail`；由擁有頁面的 feature 在 `routeLinks.ts` 登記。 */
  to: string;
  params?: RouteLinkParams;
  children: ReactNode;
}

/**
 * 連到別的 feature 的頁面（docs/architecture/frontend/03-feature-anatomy.md §4.1）：只認 route id，不 import 對方的 route。
 * 解析不出來（對方沒安裝、id 沒登記、缺參數）時只渲染文字，不可點；其餘屬性兩種情況都套用。
 */
export function RouteLink({ to, params = NO_PARAMS, children, ...rest }: RouteLinkProps) {
  const resolve = useRouteLinkResolver();
  const link = resolve({ route: to, params });
  if (!link) return <span {...rest}>{children}</span>;
  return (
    <Link to={link.to} params={link.params} search={link.search} {...rest}>
      {children}
    </Link>
  );
}
