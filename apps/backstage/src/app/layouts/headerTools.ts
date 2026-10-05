import { BatchQueueIndicator } from '@b2b-system/web-core/batch';
import { RealtimeStatusIndicator } from '@b2b-system/web-core/layout';
import { ThemeMenu } from '@b2b-system/web-core/layout';
import { registerHeaderTool } from '@b2b-system/web-core/toolbar';
import { SUPPORTED_LANGUAGES } from '@b2b-system/web-shared/constants';

import { LanguageMenu } from './LanguageMenu';

/**
 * 頂列的內建工具。之後追加的工具在這裡或 feature 的 plugin 登記，偏好頁會自動列出。
 * `order` 預留間隔，之後插在中間不必改既有的值。
 */
export function registerBuiltinHeaderTools(): void {
  // 關掉只是不顯示佇列按鈕；批次結束的結果仍由 BatchQueueNotifier 彈出
  registerHeaderTool({
    key: 'batchQueue',
    order: 100,
    labelI18nKey: 'common.batch.queue.title',
    icon: 'upload',
    Component: BatchQueueIndicator,
  });
  registerHeaderTool({
    key: 'realtimeStatus',
    order: 150,
    labelI18nKey: 'realtime.status.label',
    icon: 'wifi',
    Component: RealtimeStatusIndicator,
  });
  // 只有一種語言時沒有東西可切換，連偏好頁都不列出
  if (SUPPORTED_LANGUAGES.length > 1) {
    registerHeaderTool({
      key: 'language',
      order: 200,
      labelI18nKey: 'language.label',
      icon: 'globe',
      Component: LanguageMenu,
    });
  }
  registerHeaderTool({
    key: 'theme',
    order: 300,
    labelI18nKey: 'theme.label',
    icon: 'sun',
    Component: ThemeMenu,
  });
}
