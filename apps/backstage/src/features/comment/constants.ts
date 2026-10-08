import type { CommentableResourceType } from '@/apis/comment/types';

/** 後端已登記留言與關注的資源類型（docs/architecture/backend/24-comment.md §1）；面板只掛在這些資源的頁面上。 */
export const COMMENTABLE_RESOURCE_TYPES = [
  'user',
] as const satisfies readonly CommentableResourceType[];

export function isCommentable(resourceType: string): resourceType is CommentableResourceType {
  return (COMMENTABLE_RESOURCE_TYPES as readonly string[]).includes(resourceType);
}
