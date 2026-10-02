import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';
import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { ANNOUNCEMENT_LOCALE_SCOPE } from '../locale';
import { AnnouncementSearchQuerySchema, DEFAULT_ANNOUNCEMENT_SEARCH } from './model';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/adr/0031-announcements.md D20）。 */
export const ANNOUNCEMENT_FEATURE = 'announcement';

/** 公告列表（`announcement:read`）。 */
export const AnnouncementListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/announcement',
  beforeLoad: requireFeature(ANNOUNCEMENT_FEATURE),
  loader: localeScopeLoader(ANNOUNCEMENT_LOCALE_SCOPE),
  validateSearch: AnnouncementSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_ANNOUNCEMENT_SEARCH)] },
});

/** 建立草稿的對話框：可分享網址、上一頁＝關閉對話框。 */
export const AnnouncementCreateRoute = createRoute({
  getParentRoute: () => AnnouncementListRoute,
  path: 'create',
  validateSearch: AnnouncementSearchQuerySchema, // 保留列表的查詢條件
});

/** 詳情：編輯、送出、暫停與恢復、發送紀錄（撤回）。 */
export const AnnouncementDetailRoute = createRoute({
  getParentRoute: () => AnnouncementListRoute,
  path: '$announcementId',
});

/**
 * 收件人看全文（route id `announcement.message`）：不要求 `announcement:read`，只看得到自己收到的。
 * 獨立的最上層 route，不掛在列表底下（列表要 `announcement:read`）。
 */
export const ANNOUNCEMENT_MESSAGE_BASE_PATH = '/announcement/message';

export const AnnouncementMessageRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: `${ANNOUNCEMENT_MESSAGE_BASE_PATH}/$dispatchId`,
  beforeLoad: requireFeature(ANNOUNCEMENT_FEATURE),
  loader: localeScopeLoader(ANNOUNCEMENT_LOCALE_SCOPE),
});
