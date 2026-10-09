import type { CommentableResourceType } from '@/apis/comment/types';

/** 後端已登記留言與關注的資源類型（docs/architecture/backend/24-comment.md §1）；面板只掛在這些資源的頁面上。 */
export const COMMENTABLE_RESOURCE_TYPES = [
  'user',
  // 圖片庫的圖片（docs/architecture/backend/26-gallery.md §11）：檢視器的資訊面板下方
  'galleryItem',
] as const satisfies readonly CommentableResourceType[];

export function isCommentable(resourceType: string): resourceType is CommentableResourceType {
  return (COMMENTABLE_RESOURCE_TYPES as readonly string[]).includes(resourceType);
}
