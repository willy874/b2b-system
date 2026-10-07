import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDate } from '@b2b-system/web-shared/date';

import type { FileGrantLevel } from '@/apis/file/types';
import type { FileFolderGrant } from '@/shared/api-sdk';

import {
  FILE_GRANT_DOWNGRADE_CONFIRM_KEY,
  FILE_GRANT_LEVEL_LABEL_KEY,
  FILE_GRANT_LEVELS,
  FILE_GRANT_REMOVE_CONFIRM_KEY,
  FILE_GRANT_SUBJECT_TYPE_LABEL_KEY,
} from '../../../constants';
import {
  useFolderGrantDeleteMutation,
  useFolderGrantSetMutation,
} from '../../../hooks/useFolderGrantMutations';

interface FileGrantRowProps {
  folderId: string;
  grant: FileFolderGrant;
  levelOptions: Array<SelectOption<FileGrantLevel>>;
  /** 直接授權、而且操作者授予得起它的等級。 */
  editable: boolean;
}

export function FileGrantRow({ folderId, grant, levelOptions, editable }: FileGrantRowProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const setGrant = useFolderGrantSetMutation();
  const removeGrant = useFolderGrantDeleteMutation();
  const subject = { subjectType: grant.subjectType, subjectId: grant.subjectId };
  // `everyone` 沒有名稱（後端回空字串）：以語系顯示
  const subjectName =
    grant.subjectType === 'everyone' ? t('file.share.everyone') : grant.subjectName;

  // 移除立即生效、對象可能是一群人：先說明影響再送出
  const remove = () =>
    void confirm({
      title: t('file.share.removeTitle'),
      description: t(FILE_GRANT_REMOVE_CONFIRM_KEY[grant.subjectType], { name: subjectName }),
      confirmLabel: t('file.share.remove'),
      tone: 'danger',
      onConfirm: () => removeGrant.mutateAsync({ params: { folderId, ...subject } }),
      'data-testid': 'file-share-remove-confirm',
    });

  const changeLevel = (level: FileGrantLevel) => {
    if (level === grant.level) return;
    const request = {
      params: {
        folderId,
        // 變更等級時保留期限；已過期的改等級等於重新授予（不過期）
        body: { ...subject, level, expiresAt: grant.isExpired ? null : grant.expiresAt },
      },
    };
    // 降級會拿走較高等級才有的操作，先確認；升級與已過期的（重新授予）直接送出
    const isDowngrade =
      !grant.isExpired && FILE_GRANT_LEVELS.indexOf(level) < FILE_GRANT_LEVELS.indexOf(grant.level);
    if (!isDowngrade) {
      setGrant.mutate(request);
      return;
    }
    void confirm({
      title: t('file.share.downgradeTitle'),
      description: t(FILE_GRANT_DOWNGRADE_CONFIRM_KEY[grant.subjectType], {
        name: subjectName,
        from: t(FILE_GRANT_LEVEL_LABEL_KEY[grant.level]),
        to: t(FILE_GRANT_LEVEL_LABEL_KEY[level]),
      }),
      confirmLabel: t('file.share.downgradeAction'),
      tone: 'danger',
      onConfirm: () => setGrant.mutateAsync(request),
      'data-testid': 'file-share-downgrade-confirm',
    });
  };
  const details = [
    grant.source
      ? t('file.share.inherited', { name: grant.source.folderName })
      : t(FILE_GRANT_SUBJECT_TYPE_LABEL_KEY[grant.subjectType]),
    grant.expiresAt && !grant.isExpired
      ? t('file.share.expiresUntil', { date: formatDate(grant.expiresAt) })
      : undefined,
  ].filter(Boolean);

  return (
    <li
      className="flex flex-wrap items-center gap-2 py-2"
      data-testid="file-share-grant"
      data-value={grant.subjectId}
      data-subject-type={grant.subjectType}
      data-source={grant.source?.folderId}
      data-expired={grant.isExpired || undefined}
    >
      <Icon
        name={grant.subjectType === 'user' ? 'user' : 'users'}
        size={16}
        className="text-[var(--color-fg-muted)]"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{subjectName}</span>
        <span className="text-xs text-[var(--color-fg-muted)]">{details.join(' · ')}</span>
      </div>
      {grant.isExpired && <Chip tone="warning">{t('file.share.expired')}</Chip>}
      {editable ? (
        <>
          <Select
            size="sm"
            className="w-36"
            aria-label={t('file.share.level')}
            options={levelOptions}
            value={grant.level}
            disabled={setGrant.isPending}
            onValueChange={changeLevel}
            data-testid="file-share-grant-level"
          />
          <Button
            variant="ghost"
            size="sm"
            loading={removeGrant.isPending}
            aria-label={t('file.share.removeLabel', { name: subjectName })}
            onClick={remove}
            data-testid="file-share-grant-remove"
          >
            {t('file.share.remove')}
          </Button>
        </>
      ) : (
        <Chip tone={grant.source ? 'neutral' : 'brand'}>
          {t(FILE_GRANT_LEVEL_LABEL_KEY[grant.level])}
        </Chip>
      )}
    </li>
  );
}
