import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { sessionStore } from '../auth';
import { formDraftStore, registerFormDraft, sanitizeDraft } from './formDrafts';

export interface UseFormDraftOptions<T> {
  /** 草稿的識別：route id ＋ 實體 id（例：`user.detail:<id>`、`announcement.create`）。 */
  key: string;
  /** 目前的表單內容（含編輯開始時的 `version`：還原後送出仍以它做樂觀鎖）。 */
  values: T;
  /** 有沒有未儲存的改動：只有 dirty 的表單會在 session 結束時存下。 */
  dirty: boolean;
  /**
   * 套用還原的內容。存下時已拿掉敏感與 `exclude` 的欄位，所以是 `Partial`：與目前的內容合併
   * （`setValues((current) => ({ ...current, ...saved }))`）。
   */
  onRestore: (values: Partial<T>) => void;
  /** 不存的欄位名稱（密碼、密鑰、token 一律不存，不必列）。 */
  exclude?: readonly string[];
}

export interface FormDraftState {
  /** 有上次未儲存的內容時是它存下的時刻；沒有是 `undefined`。 */
  savedAt: number | undefined;
  restore: () => void;
  discard: () => void;
}

/**
 * 表單選擇加入「session 非自願結束時保留草稿」（docs/architecture/frontend/09-state-and-storage.md §4.4）：
 * 結束當下存下 dirty 的內容，重新登入回到同一頁時以 `savedAt` 提示（`FormDraftNotice`），由使用者決定還原或捨棄。
 * 不自動套用；不做定時自動儲存。
 */
export function useFormDraft<T>({
  key,
  values,
  dirty,
  onRestore,
  exclude,
}: UseFormDraftOptions<T>): FormDraftState {
  const latest = useRef({ values, dirty, onRestore });
  useLayoutEffect(() => {
    latest.current = { values, dirty, onRestore };
  });
  const excluded = useMemo(() => new Set(exclude), [exclude]);
  const [pending, setPending] = useState<{ data: Partial<T>; savedAt: number }>();

  useEffect(
    () =>
      registerFormDraft({
        key,
        capture: () =>
          latest.current.dirty ? sanitizeDraft(latest.current.values, excluded) : undefined,
      }),
    [key, excluded],
  );

  // 掛載時找同一個人、同一個 key 的草稿
  useEffect(() => {
    const owner = sessionStore.getIdentity();
    if (!owner) return;
    let active = true;
    void formDraftStore()
      .load<Partial<T>>(owner, key)
      .then((record) => {
        if (active && record) setPending(record);
      });
    return () => {
      active = false;
    };
  }, [key]);

  const forget = useCallback(() => {
    setPending(undefined);
    const owner = sessionStore.getIdentity();
    if (owner) void formDraftStore().remove(owner, key);
  }, [key]);

  const restore = useCallback(() => {
    if (pending) latest.current.onRestore(pending.data);
    forget();
  }, [forget, pending]);

  return { savedAt: pending?.savedAt, restore, discard: forget };
}
