import { coalesce } from '@b2b-system/web-core/image';

import { invalidateResources, Resource } from '@/apis/resources';

/**
 * 圖片庫的簽章網址過期或快過期（docs/architecture/backend/25-image.md §5）：重抓圖片的列表、詳情與相簿（封面跟著圖片變）。
 * 一頁幾十張同時過期時只失效一次；格子、列表、檢視器、選圖來源共用同一個，彼此也只算一次。
 */
export const onGalleryImageExpired = coalesce(() =>
  invalidateResources([{ resource: Resource.GALLERY_ITEM, kind: 'update' }]),
);
