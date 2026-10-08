/**
 * 可以留言與關注的資源類型（後端由擁有者模組登記，docs/architecture/backend/24-comment.md §1）。
 * 新增一種時同時改後端的登記與這裡。
 */
export type CommentableResourceType = 'user';

/** 一個資源：留言與關注的端點都以它定位。 */
export interface CommentTargetParams {
  resourceType: CommentableResourceType;
  resourceId: string;
}
