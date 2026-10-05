import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import {
  imageThumbnailGenerator,
  registerFileValidator,
  registerThumbnailGenerator,
} from '@/core/file';

import { registerFileBatchOperations } from './batch';
import { FILE_LOCALE_SCOPE } from './locale';
import { registerFilePagePermissions } from './permission';
import { registerBuiltinFilePreviewers } from './preview/builtins';
import { registerFileRouteLinks } from './routeLinks';
import { registerFileTrashTypes } from './trash';
import { UPLOAD_SOURCE_MAX_AGE_MS, uploadSources } from './upload/uploadSources';
import { imageSignatureValidator, maxSizeValidator } from './upload/validators';

/** 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/frontend/02-plugin-system.md §9.2 D1）。 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    registerFilePagePermissions();
    // 批次佇列的操作：任何分頁都可能被交派執行（包括接手別的分頁排隊中的上傳）
    registerFileBatchOperations();
    registerFileTrashTypes(); // 回收桶的「檔案」「資料夾」分頁
    registerFileRouteLinks(); // 站內通知等後端連結的 route id
    // 擴充點的內建項目；其他格式由別的 feature / plugin 以同樣的 API 註冊（core/file）
    registerBuiltinFilePreviewers();
    registerFileValidator(maxSizeValidator);
    registerFileValidator(imageSignatureValidator);
    registerThumbnailGenerator(imageThumbnailGenerator);
    const app = context.getInstance();

    return {
      name: 'app-file-feature-plugin',
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
          { scope: FILE_LOCALE_SCOPE },
        );
        // 分頁當掉留下的排隊檔案；不等它完成，失敗也無妨
        void uploadSources.prune(UPLOAD_SOURCE_MAX_AGE_MS);
      },
    };
  };
}
