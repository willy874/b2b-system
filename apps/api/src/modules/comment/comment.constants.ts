/** 留言內容的上限（docs/architecture/backend/24-comment.md §8.2 D11）。 */
export const COMMENT_BODY_MAX_LENGTH = 4000;

/** 一則留言最多 @提及幾個人（D11）。 */
export const COMMENT_MAX_MENTIONS = 20;

export const COMMENT_PAGE_DEFAULT = 20;
export const COMMENT_PAGE_MAX = 100;

/** 通知裡的留言摘要：前幾個字（通知的參數 ≤ 4 KiB，docs/architecture/backend/15-notification.md §3.2）。 */
export const COMMENT_EXCERPT_LENGTH = 100;

/** @提及的候選最多回幾個人。 */
export const MENTION_CANDIDATE_LIMIT = 10;

/**
 * 候選先從使用者表取這麼多人，再交給擁有者過濾「看得到」的：看不到的人多時候選可能少於 `MENTION_CANDIDATE_LIMIT`，
 * 使用者多打幾個字就會出現。
 */
export const MENTION_SEARCH_POOL = 50;
