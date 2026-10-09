import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { galleryUploadSources, registerGalleryBatchOperations } from './batch';
import { registerGalleryFileAction } from './fileAction/register';
import { registerGalleryImageSource } from './imageSource/register';
import { GALLERY_LOCALE_SCOPE } from './locale';
import { registerGalleryNavigation } from './navigation';
import { registerGalleryPagePermissions } from './permission';
import { registerGalleryRouteLinks } from './routeLinks';
import { registerGalleryTrashTypes } from './trash';

/**
 * 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/frontend/24-gallery.md §1）。
 * 卸載時（平台關掉 `gallery`）登記的檔案動作與圖片來源一起消失：檔案管理器與選圖不必處理圖片庫的開關（後端 D0）。
 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerGalleryPagePermissions();
    registerGalleryNavigation(); // 側欄與命令面板的入口
    registerGalleryBatchOperations(); // 任何分頁都可能被交派執行（包括接手別的分頁排隊中的上傳）
    registerGalleryTrashTypes(); // 回收桶的「圖片庫」「相簿」分頁
    registerGalleryRouteLinks(); // 留言、關注的通知連到檢視器
    registerGalleryFileAction(); // 檔案管理器的「加入圖片庫」（core/file）
    registerGalleryImageSource(); // 選圖的來源「圖片庫」（web-core/image-picker）
    const app = context.getInstance();
    let offSessionEnd: (() => void) | undefined;

    return {
      name: 'app-gallery-feature-plugin',
      onInit: () => {
        app.addResourceBundle(
          {
            [Languages.EN_US]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/en_US.json'),
            },
            [Languages.ZH_TW]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/zh_TW.json'),
            },
          },
          { scope: GALLERY_LOCALE_SCOPE },
        );
        // 分頁當掉留下的排隊檔案；不等它完成，失敗也無妨
        void galleryUploadSources.prune();
        // session 結束時清掉排隊中的檔案；feature 被停用（卸載）時解除
        offSessionEnd = galleryUploadSources.clearOnSessionEnd();
      },
      onDestroy: () => offSessionEnd?.(),
    };
  };
}
