import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { GalleryAlbumRoute, GalleryRoute } from './routes/pages';

/**
 * 別的 feature 與後端（留言、關注的通知）連到圖片庫用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）：
 * 一張圖不是子路由，而是圖片庫的 `?item=`（打開檢視器）。
 */
export function registerGalleryRouteLinks(): void {
  registerRouteLink('gallery.home', { route: GalleryRoute });
  registerRouteLink('gallery.item', { route: GalleryRoute, search: { item: 'itemId' } });
  registerRouteLink('gallery.album', {
    route: GalleryAlbumRoute,
    params: { albumId: 'albumId' },
  });
}
