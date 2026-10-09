import * as Pages from './pages';
import * as Routes from './routes';

// 圖片庫與相簿頁是同一個頁面元件（相簿頁只是多了 `albumId` 篩選）
Routes.GalleryRoute.update({ component: Pages.AsyncGalleryPage });
Routes.GalleryAlbumRoute.update({ component: Pages.AsyncGalleryPage });

export { Routes };
export { GALLERY_FEATURE } from './routes';
export { GALLERY_PAGE, registerGalleryPagePermissions } from './permission';
export { appContextPlugin as galleryFeaturePlugin } from './plugin';
export { registerGalleryNavigation } from './navigation';
