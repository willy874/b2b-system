import { useEffect, useState } from 'react';

import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { useLatestRef } from '@/components/useLatestRef';

/** 停止輸入多久後才送出（寫進網址、觸發查詢）。 */
export const TABLE_SEARCH_DEBOUNCE_MS = 300;

export interface TableSearchProps {
  /** 目前生效的關鍵字（通常來自網址）。 */
  value: string | undefined;
  /** 空白或清空時送出 `undefined`。 */
  onChange: (value: string | undefined) => void;
  /** 輸入框的提示，也是它的無障礙名稱。 */
  placeholder: string;
}

/**
 * 列表上方常駐的搜尋框：找人是後台最常用的動作，不該藏在篩選浮層裡。
 * 停止輸入 300ms 或按 Enter 才送出。
 */
export function TableSearch({ value, onChange, placeholder }: TableSearchProps) {
  const [draft, setDraft] = useState(value ?? '');
  const onChangeRef = useLatestRef(onChange);
  // 網址上的值被別處改掉（清除篩選、上一頁）時跟著更新；以「上一次看到的值」判斷，不用 effect 同步
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value ?? '');
  }

  const normalized = draft.trim() || undefined;
  useEffect(() => {
    if (normalized === value) return;
    const timer = setTimeout(() => onChangeRef.current(normalized), TABLE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [normalized, onChangeRef, value]);

  return (
    <div className="relative w-full max-w-80">
      <Icon
        name="search"
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-fg-muted)]"
      />
      <Input
        type="search"
        size="sm"
        className="ps-8"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && normalized !== value) onChange(normalized);
        }}
        data-testid="table-search"
      />
    </div>
  );
}
