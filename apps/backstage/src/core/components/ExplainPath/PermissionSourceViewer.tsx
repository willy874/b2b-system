import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';

import { ExplainPath } from './ExplainPath';
import type { PermissionSourceItem } from './permissionSourceModel';

interface PermissionSourceViewerProps {
  item: PermissionSourceItem;
  name: string;
  /** 窄畫面一次只顯示一欄：回到清單。 */
  onBack: () => void;
}

/**
 * 一個權限的所有來源（docs/architecture/iam/08-explain.md §5）：每個來源一條路徑——經由哪些群組、哪個角色，
 * 明確授予或由依賴樹帶出。
 */
export function PermissionSourceViewer({ item, name, onBack }: PermissionSourceViewerProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" data-testid="permission-source-viewer">
      <div className="md:hidden">
        <Button size="sm" variant="ghost" onClick={onBack} data-testid="permission-source-back">
          <Icon name="chevron-left" size={14} />
          {t('explain.viewer.back')}
        </Button>
      </div>
      <header className="flex flex-col gap-0.5">
        <h3 className="m-0 text-base font-semibold">{name}</h3>
        <code className="font-mono text-xs text-[var(--color-fg-muted)]">{item.key}</code>
        <p className="m-0 mt-1 text-xs text-[var(--color-fg-muted)]">
          {t('explain.viewer.description', { count: item.sources.length })}
        </p>
      </header>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {item.sources.map((source, index) => (
          <li
            // 同一個鍵可能有多個來源（不同的角色或群組）；來源沒有自然的 id
            // oxlint-disable-next-line react/no-array-index-key -- 後端給的固定順序
            key={index}
            className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
            data-testid="permission-source-path"
          >
            <ExplainPath nodes={source.via} />
            <div>
              {source.grantedKey === item.key ? (
                <Chip tone="success">{t('explain.granted')}</Chip>
              ) : (
                <Chip>
                  {t('explain.impliedBy', {
                    name: t(source.grantedNameI18nKey) || source.grantedKey,
                  })}
                </Chip>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
