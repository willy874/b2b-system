import { RESOURCE_TYPE } from '@/core/resource';

/**
 * 加入版本歷史的資源類型（docs/architecture/backend/14-revisions.md §9.2 D1：選擇性加入）。擁有者模組加入時在這裡加一個值，
 * 以 `toRevision()` 白名單產生快照、在同一個業務交易內呼叫 `RevisionService.record()`，並提供自己的版本端點
 * （docs/architecture/backend/14-revisions.md §6）。
 */
export const REVISION_RESOURCE_TYPES = [RESOURCE_TYPE.ROLE] as const;

export type RevisionResourceType = (typeof REVISION_RESOURCE_TYPES)[number];

/**
 * 單版快照的上限（`JSON.stringify` 後的 UTF-8 位元組數，docs/architecture/backend/14-revisions.md §9.2 D1）。超過時業務寫入照常成功，
 * 那一版 `snapshot = null` 並記 warn log。
 */
export const REVISION_SNAPSHOT_MAX_BYTES = 1024 * 1024;

/** `revision.prune` 每個交易刪除的筆數上限：保留清理不長時間鎖住大量的列。 */
export const REVISION_PRUNE_BATCH_SIZE = 1000;
