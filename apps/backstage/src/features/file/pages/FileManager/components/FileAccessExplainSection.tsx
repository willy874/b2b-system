import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getFileFolderExplainQueryOptions } from '@/apis/file/get-file-folder-explain/query';
import { getFileGrantSubjectListQueryOptions } from '@/apis/file/get-file-grant-subjects/query';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { ExplainPath, QueryError } from '@/core/components';
import { useTranslation } from '@/core/locales';
import type { FileAccessExplain } from '@/shared/api-sdk';

/** 使用者搜尋的輸入停頓多久才查詢（與新增授權的搜尋相同）。 */
const USER_SEARCH_DEBOUNCE_MS = 250;

/** 動作 → 標籤（全域語系的 `explain.relation.*`，與路徑上的動作同一組文案）。 */
const ACTION_LABEL_KEY = {
  read: 'explain.relation.can_read',
  create: 'explain.relation.can_create',
  update: 'explain.relation.can_update',
  delete: 'explain.relation.can_delete',
  share: 'explain.relation.can_share',
} as const satisfies Record<FileAccessExplain['actions'][number]['action'], string>;

interface FileAccessExplainSectionProps {
  folderId: string;
}

/**
 * 共用對話框的「檢查存取」（docs/rbac/01-domain-model.md §9 G4b）：挑一位使用者，列出每個動作能不能做與經由哪條授權。
 * 看別人要 `authz:explain`（呼叫端決定是否顯示）；路徑上讀不到的節點由後端遮蔽（D14）。
 */
export function FileAccessExplainSection({ folderId }: FileAccessExplainSectionProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword.trim()), USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);
  const users = useQuery(
    getFileGrantSubjectListQueryOptions({
      folderId,
      subjectType: 'user',
      keyword: debounced || undefined,
    }),
  );
  const explain = useQuery({
    ...getFileFolderExplainQueryOptions(folderId, userId ?? ''),
    enabled: Boolean(userId),
  });

  return (
    <section className="flex flex-col gap-2" data-testid="file-access-explain">
      <h3 className="m-0 text-sm font-medium text-[var(--color-fg-muted)]">
        {t('file.explain.title')}
      </h3>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('file.explain.hint')}</p>
      <Select
        aria-label={t('file.explain.user')}
        placeholder={t('file.explain.placeholder')}
        options={(users.data?.items ?? []).map((user) => ({
          value: user.id,
          label: user.name,
          description: user.hint ?? undefined,
        }))}
        value={userId}
        onValueChange={setUserId}
        searchable
        searchValue={keyword}
        onSearchChange={setKeyword}
        filterOption={false}
        loading={users.isFetching}
        data-testid="file-access-explain-user"
      />
      {userId &&
        (explain.isPending ? (
          <Spinner size={16} />
        ) : explain.isError ? (
          <QueryError error={explain.error} onRetry={() => void explain.refetch()} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {explain.data.actions.map((item) => (
              <li
                key={item.action}
                className="flex flex-col gap-1"
                data-testid="file-access-explain-action"
                data-value={item.action}
                data-allowed={item.allowed}
              >
                <span className="inline-flex items-center gap-1 text-sm">
                  <Icon name={item.allowed ? 'check' : 'close'} size={14} />
                  {t(ACTION_LABEL_KEY[item.action])}
                  <span className="text-xs text-[var(--color-fg-muted)]">
                    {item.allowed ? t('file.explain.allowed') : t('file.explain.denied')}
                  </span>
                </span>
                {item.path && (
                  <div className="pl-5">
                    <ExplainPath nodes={item.path} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
