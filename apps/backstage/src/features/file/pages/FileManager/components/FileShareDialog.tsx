import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import type { SelectOption } from '@b2b-system/ui/Select';
import { Spinner } from '@b2b-system/ui/Spinner';
import { Switch } from '@b2b-system/ui/Switch';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getFileFolderGrantListQueryOptions } from '@/apis/file/get-file-folder-grants/query';
import type { FileGrantLevel } from '@/apis/file/types';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

import { FILE_GRANT_LEVEL_HINT_KEY, FILE_GRANT_LEVEL_LABEL_KEY } from '../../../constants';
import { useFileExplainPermission } from '../../../hooks/useFileExplainPermission';
import { useFolderInheritanceMutation } from '../../../hooks/useFolderGrantMutations';
import { FileAccessExplainSection } from './FileAccessExplainSection';
import { FileAccessRequestSection } from './FileAccessRequestSection';
import { FileGrantAddRow } from './FileGrantAddRow';
import { FileGrantRow } from './FileGrantRow';

interface FileShareDialogProps {
  /** 要管理授權的資料夾；`undefined` 時關閉。 */
  folder: { id: string; name: string } | undefined;
  onClose: () => void;
}

/**
 * 資料夾的授權（docs/architecture/frontend/12-file-manager.md §13；規則 docs/architecture/iam/06-resource-grants.md §6）。
 * - 對象是角色或個別使用者，可以設定期限；過期的仍列出，由管理者移除或延長。
 * - 直接授權可以變更等級或移除；繼承來的只顯示來源（要到那個資料夾改）。
 * - 「繼承上層資料夾的授權」關閉 ＝ 私人資料夾；關閉的當下後端會複製目前繼承到的授權。
 * 等級選單只列出操作者授予得起的（`assignableLevels`，反提權），超出的授權唯讀；後端仍會再檢查。
 * - 群組沒有啟用時不列群組的授權（新增列也沒有「群組」這個種類）。
 */
export function FileShareDialog({ folder, onClose }: FileShareDialogProps) {
  const { t } = useTranslation();
  const { canExplain } = useFileExplainPermission();
  const grants = useQuery({
    ...getFileFolderGrantListQueryOptions(folder?.id ?? ''),
    enabled: Boolean(folder),
  });
  const inheritance = useFolderInheritanceMutation();
  // 租戶沒有啟用 `group` 時，既有的群組授權不列出：它們不生效，改等級或移除也會被後端以 FEATURE_DISABLED 擋下
  // （docs/architecture/iam/07-groups.md §8）。資料保留，重新啟用後照舊出現
  const hasGroups = useIsFeatureReady(TenantFeature.group);
  const visibleGrants = (grants.data?.items ?? []).filter(
    (grant) => hasGroups || grant.subjectType !== 'group',
  );
  const assignable = grants.data?.assignableLevels ?? [];
  const levelOptions: Array<SelectOption<FileGrantLevel>> = assignable.map((level) => ({
    value: level,
    label: t(FILE_GRANT_LEVEL_LABEL_KEY[level]),
    description: t(FILE_GRANT_LEVEL_HINT_KEY[level]),
  }));

  return (
    <Dialog
      open={Boolean(folder)}
      onOpenChange={(open) => !open && onClose()}
      title={t('file.share.title', { name: folder?.name ?? '' })}
      description={t('file.share.description')}
      size="md"
      data-testid="file-share-dialog"
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {folder && (
        <div className="flex flex-col gap-4">
          {grants.data && (
            <div className="flex items-start gap-3 rounded-md border border-[var(--color-border)] p-3">
              <Switch
                checked={grants.data.inheritGrants}
                disabled={inheritance.isPending}
                onCheckedChange={(inheritGrants) =>
                  inheritance.mutate({ params: { folderId: folder.id, body: { inheritGrants } } })
                }
                aria-label={t('file.share.inherit')}
                data-testid="file-share-inherit"
              />
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t('file.share.inherit')}</span>
                <span className="text-xs text-[var(--color-fg-muted)]">
                  {t('file.share.inheritHint')}
                </span>
              </span>
            </div>
          )}
          <FileAccessRequestSection folderId={folder.id} />
          {assignable.length > 0 && (
            <FileGrantAddRow key={folder.id} folderId={folder.id} levelOptions={levelOptions} />
          )}
          <section className="flex flex-col gap-2" aria-label={t('file.share.list')}>
            <h3 className="text-sm font-medium text-[var(--color-fg-muted)]">
              {t('file.share.list')}
            </h3>
            {grants.isPending ? (
              <Spinner size={16} />
            ) : visibleGrants.length ? (
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {visibleGrants.map((grant) => (
                  <FileGrantRow
                    key={`${grant.source?.folderId ?? 'direct'}:${grant.subjectType}:${grant.subjectId}`}
                    folderId={folder.id}
                    grant={grant}
                    levelOptions={levelOptions}
                    editable={grant.source === null && assignable.includes(grant.level)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-fg-muted)]" data-testid="file-share-empty">
                {t('file.share.empty')}
              </p>
            )}
          </section>
          {canExplain && <FileAccessExplainSection folderId={folder.id} />}
        </div>
      )}
    </Dialog>
  );
}
