import { Link } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { useRouteLinkAccess } from './hooks';
import type { RouteLinkParams } from './registry';

const NO_PARAMS: RouteLinkParams = {};

interface RouteLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** route id，例：`user.detail`；由擁有頁面的 feature 在 `routeLinks.ts` 登記。必須寫完整的字面量。 */
  to: string;
  params?: RouteLinkParams;
  /**
   * 不能點時（對方沒安裝、沒權限、權限還沒水合）怎麼顯示：
   * `text`（預設）只顯示文字——名字本身有資訊時用；`hide` 整個不渲染——純導覽用的連結。
   */
  fallback?: 'text' | 'hide';
  children: ReactNode;
}

/**
 * 連到別的 feature 的頁面（docs/architecture/frontend/03-feature-anatomy.md §4.1）：只認 route id，不 import 對方的 route。
 * 渲染前就判斷能不能點，不讓人點進 404／403；其餘屬性在連結與文字兩種情況都套用。
 */
export function RouteLink({
  to,
  params = NO_PARAMS,
  fallback = 'text',
  children,
  ...rest
}: RouteLinkProps) {
  const access = useRouteLinkAccess(to, params);
  if (access.status !== 'ready') {
    return fallback === 'hide' ? null : <span {...rest}>{children}</span>;
  }
  const { link } = access;
  return (
    <Link to={link.to} params={link.params} search={link.search} {...rest}>
      {children}
    </Link>
  );
}
