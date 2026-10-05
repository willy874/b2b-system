import { LanguageMenu as CoreLanguageMenu } from '@b2b-system/web-core/layout';

import { useChangeLocale } from '@/features/account';

/** 頂列的語言切換：切換的行為與偏好頁共用 `useChangeLocale`。 */
export function LanguageMenu() {
  const changeLocale = useChangeLocale();
  return <CoreLanguageMenu onChange={changeLocale} />;
}
