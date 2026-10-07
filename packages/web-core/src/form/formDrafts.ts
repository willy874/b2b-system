import { createDraftStore } from '@b2b-system/web-shared/storage';
import type { DraftStore } from '@b2b-system/web-shared/storage';

import { PASSWORD_CHANGED_REASON } from '../auth';

/**
 * 只在非自願、而且回來的仍是同一個人的結束原因保留草稿（docs/architecture/frontend/09-state-and-storage.md §4.4）：
 * 續期因為閒置太久或家族到期被拒、在其他分頁改了密碼。登出、單一登出、偵測到重用、帳號停用、被撤銷都不保留，
 * 並清掉那個人既有的草稿——可能是共用電腦，或帳號已經落在別人手上。
 */
export const DRAFT_KEEPING_END_REASONS: ReadonlySet<string> = new Set([
  'AUTH_REFRESH_EXPIRED',
  'AUTH_REFRESH_INVALID',
  PASSWORD_CHANGED_REASON,
]);

/** 欄位名稱符合這些字的值一律不存（密碼、密鑰、token），不論表單有沒有列在 `exclude`。 */
const SENSITIVE_KEY = /password|secret|token/i;

interface RegisteredDraft {
  key: string;
  /** dirty 時回傳要存的內容；沒有改動回 `undefined`。 */
  capture: () => unknown;
}

const registered = new Set<RegisteredDraft>();
let store: DraftStore | undefined;

/** 全域的草稿儲存（測試以 `setFormDraftStore` 換成只用記憶體的）。 */
export function formDraftStore(): DraftStore {
  store ??= createDraftStore();
  return store;
}

export function setFormDraftStore(next: DraftStore | undefined): void {
  store = next;
}

/** `useFormDraft` 登記；回傳取消登記。 */
export function registerFormDraft(entry: RegisteredDraft): () => void {
  registered.add(entry);
  return () => registered.delete(entry);
}

/** 拿掉敏感欄位與 `exclude` 列出的欄位（巢狀物件一併處理；陣列保留）。 */
export function sanitizeDraft(value: unknown, exclude: ReadonlySet<string> = new Set()): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeDraft(item, exclude));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !SENSITIVE_KEY.test(name) && !exclude.has(name))
      .map(([name, item]) => [name, sanitizeDraft(item, exclude)]),
  );
}

/**
 * session 結束（`SessionWatcher`）：保留的原因先 **同步** 取出每個 dirty 表單的內容（之後頁面就被導走、卸載），
 * 再加密存起來；其他原因清掉那個人的草稿。
 */
export function handleSessionEndForDrafts(
  reason: string,
  owner: string | undefined,
): Promise<void> {
  if (!owner) return Promise.resolve();
  if (!DRAFT_KEEPING_END_REASONS.has(reason)) return formDraftStore().removeOwner(owner);
  const captured = [...registered]
    .map((entry) => ({ key: entry.key, data: entry.capture() }))
    .filter((entry) => entry.data !== undefined);
  return Promise.all(
    captured.map((entry) => formDraftStore().save(owner, entry.key, entry.data)),
  ).then(() => undefined);
}

/** 登入（或續期）成為某個人：其他人的草稿一律清掉（§4.4）。 */
export function handleSessionStartForDrafts(owner: string | undefined): Promise<void> {
  if (!owner) return Promise.resolve();
  return formDraftStore().keepOnlyOwner(owner);
}
