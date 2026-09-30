import type { AppPluginFactory } from '@/core/app';
import {
  imageThumbnailGenerator,
  registerFileValidator,
  registerThumbnailGenerator,
} from '@/core/file';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { registerFileBatchOperations } from './batch';
import { FILE_LOCALE_SCOPE } from './locale';
import { registerFilePagePermissions } from './permission';
import { registerBuiltinFilePreviewers } from './preview/builtins';
import { UPLOAD_SOURCE_MAX_AGE_MS, uploadSources } from './upload/uploadSources';
import { imageSignatureValidator, maxSizeValidator } from './upload/validators';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerFilePagePermissions();
    // 批次佇列的操作：任何分頁都可能被交派執行（包括接手別的分頁排隊中的上傳）
    registerFileBatchOperations();
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
