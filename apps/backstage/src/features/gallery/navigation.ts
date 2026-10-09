import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { GALLERY_PAGE } from './permission';

/** 側欄的入口（「功能」群組，排在檔案管理之後）；命令面板的「頁面」也列出它。 */
export function registerGalleryNavigation(): void {
  registerNavItem({
    pageKey: GALLERY_PAGE,
    to: '/gallery',
    labelKey: 'menu.gallery',
    testId: 'menu-gallery',
    icon: 'file-image',
    group: NavGroupKey.FEATURE,
    order: 110,
  });
}
