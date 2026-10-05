import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { PermissionCatalog } from '@/shared/api-sdk';

export interface PermissionCatalogListProps {
  catalog: PermissionCatalog;
  held: ReadonlySet<string>;
  /** 在樹狀圖中查看這個權限。 */
  onShowInTree: (key: string) => void;
}

/** 一覽表：每個資源一張卡片，依目錄順序列出權限與你是否持有。 */
export function PermissionCatalogList({ catalog, held, onShowInTree }: PermissionCatalogListProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      {catalog.groups.map((group) => (
        <section
          key={group.resource}
          className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          data-testid="permission-group"
          data-value={group.resource}
        >
          <h2 className="m-0 mb-3 text-base font-medium">{t(group.nameI18nKey)}</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {group.keys.map((key) => {
              const item = catalog.items.find((permission) => permission.key === key);
              const name = item ? t(item.nameI18nKey) : key;
              return (
                <li key={key} className="flex items-center justify-between gap-4 text-sm">
                  <span>
                    {name}
                    <code className="ml-2 font-mono text-xs text-[var(--color-fg-muted)]">
                      {key}
                    </code>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {held.has(key) ? (
                      <Chip tone="success">{t('permissionCatalog.held')}</Chip>
                    ) : (
                      <Chip tone="neutral">{t('permissionCatalog.notHeld')}</Chip>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('permissionCatalog.showInTree', { name })}
                      title={t('permissionCatalog.showInTree', { name })}
                      onClick={() => onShowInTree(key)}
                      data-testid="permission-show-in-tree"
                      data-value={key}
                    >
                      <Icon name="network" size={14} />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
