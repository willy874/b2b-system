import { useTranslation } from '@/core/locales';
import type { PermissionSources } from '@/shared/api-sdk';

import { ExplainPath } from './ExplainPath';

interface PermissionSourceListProps {
  data: PermissionSources;
}

/**
 * 有效權限與每個權限的來源（docs/rbac/01-domain-model.md §9 G4b）：經由哪些群組、哪個角色、明確授予或由依賴樹帶出。
 * 資料由呼叫端查（使用者詳情、個人資料頁都用它；core 不碰 `apis/`）。
 */
export function PermissionSourceList({ data }: PermissionSourceListProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3" data-testid="permission-source-list">
      {data.isSuperAdmin && (
        <div className="flex flex-col gap-1" data-testid="permission-source-super-admin">
          <p className="m-0 text-sm">{t('explain.superAdmin')}</p>
          {data.superAdminVia && <ExplainPath nodes={data.superAdminVia} />}
        </div>
      )}
      {data.items.length === 0 && !data.isSuperAdmin && (
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('explain.noPermissions')}</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {data.items.map((item) => (
          <li
            key={item.key}
            className="flex flex-col gap-1"
            data-testid="permission-source"
            data-value={item.key}
          >
            <code className="font-mono text-xs font-medium">{item.key}</code>
            {item.sources.map((source, index) => (
              // 同一個鍵可能有多個來源（不同的角色或群組）；來源沒有自然的 id
              // oxlint-disable-next-line react/no-array-index-key -- 後端給的固定順序
              <div key={index} className="flex flex-wrap items-center gap-2 pl-3">
                <ExplainPath nodes={source.via} />
                {source.grantedKey !== item.key && (
                  <span className="text-xs text-[var(--color-fg-muted)]">
                    {t('explain.impliedBy', { key: source.grantedKey })}
                  </span>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
