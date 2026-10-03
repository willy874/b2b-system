import { registerHeaderTool } from '@/core/toolbar';
import { SUPPORTED_LANGUAGES } from '@/shared/constants/lang';

import { LanguageMenu } from './LanguageMenu';
import { RealtimeStatusIndicator } from './RealtimeStatusIndicator';
import { ThemeMenu } from './ThemeMenu';

/**
 * 頂列的內建工具（同 apps/backstage 的 `headerTools.ts`）。之後追加的工具在這裡或 feature 的 plugin 登記，偏好頁會自動列出。
 * `order` 與 backstage 相同的間隔，之後插在中間不必改既有的值。
 */
export function registerBuiltinHeaderTools(): void {
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
