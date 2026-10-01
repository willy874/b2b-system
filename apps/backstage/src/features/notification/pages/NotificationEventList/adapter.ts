import type { NotificationEvent } from '@/shared/api-sdk';

import { NOTIFICATION_EVENT_CATEGORY_LABEL_KEY, NOTIFICATION_EVENT_LABEL } from '../../constants';
import type { NotificationEventCategoryView } from '../../types';

/** 依分類分組：分類與分類內的事件都依後端目錄的順序（擁有者模組的登記順序）。 */
export function toNotificationEventCategories(
  items: readonly NotificationEvent[],
): NotificationEventCategoryView[] {
  const categories = new Map<string, NotificationEventCategoryView>();
  for (const item of items) {
    let view = categories.get(item.category);
    if (!view) {
      view = {
        category: item.category,
        labelKey: NOTIFICATION_EVENT_CATEGORY_LABEL_KEY[item.category],
        events: [],
      };
      categories.set(item.category, view);
    }
    const label = NOTIFICATION_EVENT_LABEL[item.type];
    view.events.push({
      type: item.type,
      nameKey: label?.nameKey,
      descriptionKey: label?.descriptionKey,
      recipientsKey: label?.recipientsKey,
      mandatory: item.mandatory,
      channels: item.channels,
    });
  }
  return [...categories.values()];
}
