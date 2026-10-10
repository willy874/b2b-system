import { Select } from '@b2b-system/ui/Select';
import type { MultipleSelectProps, SelectOption, SingleSelectProps } from '@b2b-system/ui/Select';
import { useDebouncedValue } from '@b2b-system/web-shared/hooks';
import { useQuery } from '@tanstack/react-query';
import type { QueryKey, UseQueryOptions } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

/** 停止打字多久才查詢。 */
export const USER_SEARCH_DEBOUNCE_MS = 250;

/** 選項需要的使用者欄位（`GET /users` 的列與使用者詳情都有）。 */
export interface SearchableUser {
  id: string;
  displayName: string;
  email: string;
}

/** 查詢的結果至少要有使用者的清單。 */
export interface UserSearchResult {
  items: readonly SearchableUser[];
}

/** 依關鍵字查使用者的查詢；`keyword` 是去頭尾空白後的字，空的時候是 `undefined`。 */
export type UserSearchQuery<TData extends UserSearchResult, TKey extends QueryKey> = (
  keyword: string | undefined,
) => UseQueryOptions<TData, Error, TData, TKey>;

/** 交給 `Select` 的 props（搜尋、選項、載入中由這個元件處理）。 */
type ManagedSelectProps =
  | 'options'
  | 'searchable'
  | 'searchValue'
  | 'onSearchChange'
  | 'filterOption'
  | 'loading'
  | 'onOpenChange';

interface UserSearchSelectBaseProps<TData extends UserSearchResult, TKey extends QueryKey> {
  /** 查詢由呼叫端提供（`core/` 不 import `apis/`），例：`getUserSearchQueryOptions`。 */
  query: UserSearchQuery<TData, TKey>;
  /** 已選、可能不在這一批搜尋結果裡的使用者：合併進選項，觸發鈕上的名稱才不會變成 id。 */
  selected?: readonly SearchableUser[];
  /** `false` 時不查詢（例：沒有 `user:read`）；預設在下拉第一次打開之後才查。 */
  enabled?: boolean;
}

export type UserSearchSelectProps<
  TData extends UserSearchResult = UserSearchResult,
  TKey extends QueryKey = QueryKey,
> =
  | (UserSearchSelectBaseProps<TData, TKey> & Omit<SingleSelectProps, ManagedSelectProps>)
  | (UserSearchSelectBaseProps<TData, TKey> & Omit<MultipleSelectProps, ManagedSelectProps>);

function toOption(user: SearchableUser): SelectOption {
  return {
    value: user.id,
    label: user.displayName,
    textValue: `${user.displayName} ${user.email}`,
    description: user.email || undefined,
  };
}

/**
 * 在伺服器端搜尋使用者的下拉（使用者可能很多，不一次載入）：去抖動、不在本地過濾、已選的人補進選項。
 * 下拉打開之後才查，沒打開的選擇器不發請求。文字（`placeholder`、`noMatchLabel`…）由呼叫端傳入。
 */
export function UserSearchSelect<TData extends UserSearchResult, TKey extends QueryKey>({
  query,
  selected,
  enabled = true,
  ...selectProps
}: UserSearchSelectProps<TData, TKey>) {
  const [keyword, setKeyword] = useState('');
  const [opened, setOpened] = useState(false);
  const debounced = useDebouncedValue(keyword.trim(), USER_SEARCH_DEBOUNCE_MS);
  const users = useQuery({
    ...query(debounced || undefined),
    enabled: enabled && opened && !selectProps.disabled,
  });

  const options = useMemo(() => {
    const seen = new Set<string>();
    return [...(selected ?? []), ...(users.data?.items ?? [])].flatMap((user) => {
      if (seen.has(user.id)) return [];
      seen.add(user.id);
      return [toOption(user)];
    });
  }, [selected, users.data]);

  return (
    <Select
      itemSize={48}
      {...selectProps}
      options={options}
      searchable
      searchValue={keyword}
      onSearchChange={setKeyword}
      filterOption={false}
      loading={users.isFetching}
      onOpenChange={(open) => {
        if (open) setOpened(true);
      }}
    />
  );
}
