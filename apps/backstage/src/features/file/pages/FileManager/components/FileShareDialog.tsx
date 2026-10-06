import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { DatePicker } from '@b2b-system/ui/DatePicker';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Icon } from '@b2b-system/ui/Icon';
import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import { Spinner } from '@b2b-system/ui/Spinner';
import { Switch } from '@b2b-system/ui/Switch';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';

import { getFileAccessRequestListQueryOptions } from '@/apis/file/get-file-access-requests/query';
import { getFileFolderGrantListQueryOptions } from '@/apis/file/get-file-folder-grants/query';
import { getFileGrantSubjectListQueryOptions } from '@/apis/file/get-file-grant-subjects/query';
import type { FileGrantLevel, FileGrantSubjectType } from '@/apis/file/types';
import type { FileAccessRequest, FileFolderGrant } from '@/shared/api-sdk';

import {
  EVERYONE_SUBJECT_ID,
  FILE_GRANT_DOWNGRADE_CONFIRM_KEY,
  FILE_GRANT_LEVEL_HINT_KEY,
  FILE_GRANT_LEVEL_LABEL_KEY,
  FILE_GRANT_LEVELS,
  FILE_GRANT_REMOVE_CONFIRM_KEY,
  FILE_GRANT_SUBJECT_COPY_KEY,
  FILE_GRANT_SUBJECT_TYPE_LABEL_KEY,
} from '../../../constants';
import { useFileExplainPermission } from '../../../hooks/useFileExplainPermission';
import {
  useFileAccessReviewMutation,
  useFolderGrantDeleteMutation,
  useFolderGrantSetMutation,
  useFolderInheritanceMutation,
} from '../../../hooks/useFolderGrantMutations';
import { FileAccessExplainSection } from './FileAccessExplainSection';

/** 對象搜尋的去抖動：每打一個字就查一次太多。 */
const SUBJECT_SEARCH_DEBOUNCE_MS = 250;

const SUBJECT_TYPES = [
  'role',
  'user',
  'group',
  'everyone',
] as const satisfies readonly FileGrantSubjectType[];

/** 選的日期當天結束時過期（`YYYY-MM-DD` → 當地時間 23:59:59 的 ISO 字串）。 */
function endOfDay(date: string): string {
  return dayjs(date).endOf('day').toISOString();
}

interface FileShareDialogProps {
  /** 要管理授權的資料夾；`undefined` 時關閉。 */
  folder: { id: string; name: string } | undefined;
  onClose: () => void;
}

/**
 * 資料夾的授權（docs/architecture/frontend/12-file-manager.md §13；規則 docs/rbac/07-resource-grants.md §6）。
 * - 對象是角色或個別使用者，可以設定期限；過期的仍列出，由管理者移除或延長。
 * - 直接授權可以變更等級或移除；繼承來的只顯示來源（要到那個資料夾改）。
 * - 「繼承上層資料夾的授權」關閉 ＝ 私人資料夾；關閉的當下後端會複製目前繼承到的授權。
 * 等級選單只列出操作者授予得起的（`assignableLevels`，反提權），超出的授權唯讀；後端仍會再檢查。
 */
export function FileShareDialog({ folder, onClose }: FileShareDialogProps) {
  const { t } = useTranslation();
  const { canExplain } = useFileExplainPermission();
  const grants = useQuery({
    ...getFileFolderGrantListQueryOptions(folder?.id ?? ''),
    enabled: Boolean(folder),
  });
  const inheritance = useFolderInheritanceMutation();
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
          <AccessRequestSection folderId={folder.id} />
          {assignable.length > 0 && (
            <AddGrantRow key={folder.id} folderId={folder.id} levelOptions={levelOptions} />
          )}
          <section className="flex flex-col gap-2" aria-label={t('file.share.list')}>
            <h3 className="text-sm font-medium text-[var(--color-fg-muted)]">
              {t('file.share.list')}
            </h3>
            {grants.isPending ? (
              <Spinner size={16} />
            ) : grants.data?.items.length ? (
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {grants.data.items.map((grant) => (
                  <GrantRow
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

/** 待審的存取申請（docs/rbac/07-resource-grants.md §6.5）；沒有申請時不顯示。 */
function AccessRequestSection({ folderId }: { folderId: string }) {
  const { t } = useTranslation();
  const requests = useQuery(getFileAccessRequestListQueryOptions(folderId));
  const items = requests.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={t('file.access.requests')}>
      <h3 className="text-sm font-medium text-[var(--color-fg-muted)]">
        {t('file.access.requests')}
      </h3>
      <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] px-3">
        {items.map((request) => (
          <AccessRequestRow key={request.id} folderId={folderId} request={request} />
        ))}
      </ul>
    </section>
  );
}

function AccessRequestRow({ folderId, request }: { folderId: string; request: FileAccessRequest }) {
  const { t } = useTranslation();
  const review = useFileAccessReviewMutation();
  const decide = (decision: 'approve' | 'reject') =>
    review.mutate({ params: { folderId, requestId: request.id, decision, body: {} } });
  return (
    <li
      className="flex flex-wrap items-center gap-2 py-2"
      data-testid="file-access-request"
      data-value={request.id}
    >
      <Icon name="user" size={16} className="text-[var(--color-fg-muted)]" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{request.requesterName}</span>
        <span className="text-xs text-[var(--color-fg-muted)]">
          {[
            t('file.access.requestedLevel', {
              level: t(FILE_GRANT_LEVEL_LABEL_KEY[request.level]),
            }),
            request.reason,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <Button
        size="sm"
        variant="primary"
        disabled={review.isPending}
        onClick={() => decide('approve')}
        data-testid="file-access-request-approve"
      >
        {t('file.access.approve')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={review.isPending}
        onClick={() => decide('reject')}
        data-testid="file-access-request-reject"
      >
        {t('file.access.reject')}
      </Button>
    </li>
  );
}

interface AddGrantRowProps {
  folderId: string;
  levelOptions: Array<SelectOption<FileGrantLevel>>;
}

/** 新增一筆授權：對象種類 ＋ 搜尋對象（伺服器端搜尋）＋ 等級 ＋ 期限（可不填）。 */
function AddGrantRow({ folderId, levelOptions }: AddGrantRowProps) {
  const { t } = useTranslation();
  const [subjectType, setSubjectType] = useState<FileGrantSubjectType>('role');
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword.trim()), SUBJECT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [level, setLevel] = useState<FileGrantLevel | null>(null);
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  const isEveryone = subjectType === 'everyone';
  const subjects = useQuery({
    ...getFileGrantSubjectListQueryOptions({
      folderId,
      subjectType,
      keyword: debounced || undefined,
    }),
    // 所有人不必挑選對象
    enabled: !isEveryone,
  });
  const setGrant = useFolderGrantSetMutation();
  const selectedLevel = level ?? levelOptions[0]?.value ?? null;
  const copy = FILE_GRANT_SUBJECT_COPY_KEY[subjectType];

  const targetId = isEveryone ? EVERYONE_SUBJECT_ID : subjectId;

  const submit = () => {
    if (!targetId || !selectedLevel) return;
    setGrant.mutate(
      {
        params: {
          folderId,
          body: {
            subjectType,
            subjectId: targetId,
            level: selectedLevel,
            expiresAt: expiresOn ? endOfDay(expiresOn) : null,
          },
        },
      },
      {
        onSuccess: () => {
          setSubjectId(null);
          setExpiresOn(null);
        },
      },
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        className="w-28"
        aria-label={t('file.share.subjectTypeLabel')}
        options={SUBJECT_TYPES.map((type) => ({
          value: type,
          label: t(FILE_GRANT_SUBJECT_TYPE_LABEL_KEY[type]),
        }))}
        value={subjectType}
        onValueChange={(type) => {
          setSubjectType(type);
          setSubjectId(null);
          setKeyword('');
        }}
        data-testid="file-share-subject-type"
      />
      {isEveryone ? (
        <span className="min-w-48 flex-1 self-center text-sm text-[var(--color-fg-muted)]">
          {t('file.share.everyone')}
        </span>
      ) : (
        <Select
          className="min-w-48 flex-1"
          aria-label={t('file.share.subject')}
          placeholder={t(copy.placeholder)}
          options={(subjects.data?.items ?? []).map((subject) => ({
            value: subject.id,
            label: subject.name,
            description: subject.hint ?? undefined,
          }))}
          value={subjectId}
          onValueChange={setSubjectId}
          searchable
          searchValue={keyword}
          onSearchChange={setKeyword}
          filterOption={false}
          searchPlaceholder={t(copy.search)}
          noMatchLabel={t(copy.noMatch)}
          loading={subjects.isFetching}
          data-testid="file-share-subject"
        />
      )}
      <Select
        className="w-36"
        aria-label={t('file.share.level')}
        options={levelOptions}
        value={selectedLevel}
        onValueChange={setLevel}
        data-testid="file-share-level"
      />
      <DatePicker
        className="w-40"
        aria-label={t('file.share.expiresAt')}
        placeholder={t('file.share.expiresPlaceholder')}
        value={expiresOn}
        onValueChange={setExpiresOn}
        min={dayjs().format('YYYY-MM-DD')}
        clearable
        data-testid="file-share-expires"
      />
      <Button
        variant="primary"
        disabled={!targetId || !selectedLevel}
        loading={setGrant.isPending}
        onClick={submit}
        data-testid="file-share-add"
      >
        {t('file.share.add')}
      </Button>
    </div>
  );
}

interface GrantRowProps {
  folderId: string;
  grant: FileFolderGrant;
  levelOptions: Array<SelectOption<FileGrantLevel>>;
  /** 直接授權、而且操作者授予得起它的等級。 */
  editable: boolean;
}

function GrantRow({ folderId, grant, levelOptions, editable }: GrantRowProps) {
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
      ? t('file.share.expiresUntil', { date: dayjs(grant.expiresAt).format('YYYY-MM-DD') })
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
