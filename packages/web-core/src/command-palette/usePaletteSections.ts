import type { IconName } from '@b2b-system/ui/Icon';
import { useStore } from '@b2b-system/web-shared/hooks';
import { useMemo } from 'react';

import { useTranslation } from '../locales';
import { useNavigation } from '../navigation';
import type { NavItem } from '../navigation';
import { usePageAccessChecker } from '../permission';
import { useRouteLinkChecker } from '../route-link';
import { SEARCH_QUERY_MAX_LENGTH } from './constants';
import { useRecentPageStore } from './recent';
import { paletteCommandRegistry, searchProviderRegistry } from './registry';
import { SEARCH_DEBOUNCE_MS, useDataSearch, useDebouncedValue } from './useDataSearch';

export type PaletteAction =
  | {
      type: 'navigate';
      to: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
    }
  | { type: 'run'; run: () => void };

export interface PaletteOption {
  /** 整個面板裡唯一（`<分組>:<id>`），也是 E2E 的 `data-value`。 */
  id: string;
  label: string;
  description?: string;
  icon: IconName;
  action: PaletteAction;
}

export interface PaletteSection {
  /** 分組的鍵：`recent`、`pages`、`commands`，或資料提供者的 key。 */
  key: string;
  titleKey: string;
  /** 資料搜尋還沒回來或失敗時，分組只顯示狀態、沒有選項。 */
  status: 'ready' | 'loading' | 'error';
  options: PaletteOption[];
}

/** 每個以空白分開的詞都要出現在文字裡（不分大小寫）：「使用 設定」找得到「使用者設定」。 */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

const pageOption = (sectionKey: string, item: NavItem, label: string): PaletteOption => ({
  id: `${sectionKey}:${item.pageKey}`,
  label,
  icon: item.icon,
  action: { type: 'navigate', to: item.to },
});

export interface PaletteContent {
  sections: PaletteSection[];
  /** 還在防彈跳或有提供者還沒回來：這時沒有結果不代表「沒有符合的」，不顯示空狀態。 */
  isSearching: boolean;
}

/**
 * 面板的內容：沒有輸入時是「最近造訪」「頁面」「動作」；有輸入時是比對到的頁面、動作，以及各資料提供者的結果。
 * 頁面、動作、提供者都依頁面權限過濾；資料結果再以連結的目標頁過濾（docs/architecture/frontend/18-command-palette.md §3）。
 */
export function usePaletteSections(rawQuery: string): PaletteContent {
  const { t } = useTranslation();
  const query = rawQuery.trim();
  const cappedQuery = query.slice(0, SEARCH_QUERY_MAX_LENGTH);
  const searchQuery = useDebouncedValue(cappedQuery, SEARCH_DEBOUNCE_MS);
  const navigation = useNavigation();
  const { hydrated, canAccessPage } = usePageAccessChecker();
  const checkLink = useRouteLinkChecker();
  const recentPages = useRecentPageStore((state) => state.pages);
  const commandEntries = useStore(paletteCommandRegistry.store, (state) => state.entries);
  const providerEntries = useStore(searchProviderRegistry.store, (state) => state.entries);

  const canUse = useMemo(
    () => (pageKey: NavItem['pageKey'] | undefined) =>
      pageKey === undefined || (hydrated && canAccessPage(pageKey)),
    [canAccessPage, hydrated],
  );

  const pages = useMemo(
    () =>
      [
        ...navigation.topItems,
        ...navigation.groups.flatMap((group) => group.items),
        ...navigation.accountItems,
      ].filter((item) => hydrated && canAccessPage(item.pageKey)),
    [canAccessPage, hydrated, navigation],
  );

  const providers = useMemo(
    () =>
      [...providerEntries.values()]
        .filter((provider) => canUse(provider.pageKey))
        .toSorted((a, b) => a.order - b.order),
    [canUse, providerEntries],
  );
  const dataSearch = useDataSearch(searchQuery, providers);

  const isSearching =
    providers.length > 0 &&
    query !== '' &&
    (searchQuery !== cappedQuery || dataSearch.some(({ status }) => status === 'loading'));

  const sections = useMemo(() => {
    const result: PaletteSection[] = [];
    const ready = (key: string, titleKey: string, options: PaletteOption[]) => {
      if (options.length > 0) result.push({ key, titleKey, status: 'ready', options });
    };

    if (query === '') {
      const byPage = new Map(pages.map((item) => [item.pageKey, item]));
      ready(
        'recent',
        'commandPalette.recent',
        recentPages.flatMap((page) => {
          const item = byPage.get(page);
          return item ? [pageOption('recent', item, t(item.labelKey))] : [];
        }),
      );
    }

    ready(
      'pages',
      'commandPalette.pages',
      pages.flatMap((item) => {
        const label = t(item.labelKey);
        return matchesQuery(label, query) ? [pageOption('pages', item, label)] : [];
      }),
    );

    ready(
      'commands',
      'commandPalette.commands',
      [...commandEntries.values()]
        .filter((command) => canUse(command.pageKey))
        .toSorted((a, b) => a.order - b.order)
        .flatMap((command): PaletteOption[] => {
          const label = t(command.labelI18nKey);
          if (!matchesQuery(label, query)) return [];
          const action: PaletteAction =
            'to' in command
              ? { type: 'navigate', to: command.to }
              : { type: 'run', run: command.run };
          return [{ id: `commands:${command.key}`, label, icon: command.icon, action }];
        }),
    );

    // 輸入還在防彈跳時沿用上一次的查詢字串：剛打字時不會先閃「搜尋中」
    if (searchQuery !== '') {
      for (const { provider, status, results } of dataSearch) {
        if (status === 'loading' || status === 'error') {
          result.push({
            key: provider.key,
            titleKey: provider.labelI18nKey,
            status,
            options: [],
          });
          continue;
        }
        ready(
          provider.key,
          provider.labelI18nKey,
          results.flatMap((result): PaletteOption[] => {
            const link = checkLink(result.link);
            if (!link) return [];
            return [
              {
                id: `${provider.key}:${result.id}`,
                label: result.label,
                description: result.description,
                icon: provider.icon,
                action: { type: 'navigate', ...link },
              },
            ];
          }),
        );
      }
    }

    return result;
  }, [canUse, checkLink, commandEntries, dataSearch, pages, query, recentPages, searchQuery, t]);

  return { sections, isSearching };
}
