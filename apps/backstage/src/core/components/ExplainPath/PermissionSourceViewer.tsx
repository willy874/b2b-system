import { useTranslation } from '@b2b-system/web-core/locales';

import type { PermissionSources } from '@/shared/api-sdk';

import { ExplainPath } from './ExplainPath';

interface PermissionSourceViewerProps {
  item: PermissionSources['items'][number];
}

/**
 * 一個權限的所有來源（docs/architecture/iam/01-model.md §9 G4b）：每個來源一條路徑——經由哪些群組、哪個角色，
 * 明確授予或由依賴樹帶出。
 */
export function PermissionSourceViewer({ item }: PermissionSourceViewerProps) {
  const { t } = useTranslation();
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid="permission-source-viewer">
      {item.sources.map((source, index) => (
        // 同一個鍵可能有多個來源（不同的角色或群組）；來源沒有自然的 id
        // oxlint-disable-next-line react/no-array-index-key -- 後端給的固定順序
        <li
          key={index}
          className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
          data-testid="permission-source-path"
        >
          <ExplainPath nodes={source.via} />
          {source.grantedKey !== item.key && (
            <span className="text-xs text-[var(--color-fg-muted)]">
              {t('explain.impliedBy', { key: source.grantedKey })}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
