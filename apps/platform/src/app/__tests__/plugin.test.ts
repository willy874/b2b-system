import { describe, expect, it } from 'vitest';

import { createAppRouter } from '../plugin';

/** 這個網址命中的 route id（由外到內）。 */
function matchedRouteIds(pathname: string): string[] {
  return createAppRouter()
    .matchRoutes(pathname)
    .map((match) => match.routeId);
}

describe('createAppRouter：路徑分大小寫（docs/architecture/frontend/04-routing.md §4）', () => {
  it('小寫的路徑照常命中頁面', () => {
    expect(matchedRouteIds('/tenant')).toContain('/tenant');
    expect(matchedRouteIds('/admin')).toContain('/admin');
  });

  it.each(['/TENANT', '/Admin', '/AUDIT-LOG'])(
    '%s 不命中任何頁面（404），不會繞過以原始網址比對的頁面權限守衛',
    (pathname) => {
      expect(matchedRouteIds(pathname)).toEqual(['__root__']);
    },
  );

  it('動態參數的大小寫不受影響（IdP 的互動 uid）', () => {
    expect(matchedRouteIds('/interaction/AbC-123')).toContain('/interaction/$uid');
  });
});
