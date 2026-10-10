import { Button } from '@b2b-system/ui/Button';
import { DatePicker } from '@b2b-system/ui/DatePicker';
import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { todayInZone, zonedDayBoundary } from '@b2b-system/web-shared/date';
import { useDebouncedValue } from '@b2b-system/web-shared/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getFileGrantSubjectListQueryOptions } from '@/apis/file/get-file-grant-subjects/query';
import type { FileGrantLevel, FileGrantSubjectType } from '@/apis/file/types';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

import {
  EVERYONE_SUBJECT_ID,
  FILE_GRANT_SUBJECT_COPY_KEY,
  FILE_GRANT_SUBJECT_TYPE_LABEL_KEY,
} from '../../../constants';
import { useFolderGrantSetMutation } from '../../../hooks/useFolderGrantMutations';

/** 對象搜尋的去抖動：每打一個字就查一次太多。 */
const SUBJECT_SEARCH_DEBOUNCE_MS = 250;

const SUBJECT_TYPES = [
  'role',
  'user',
  'group',
  'everyone',
] as const satisfies readonly FileGrantSubjectType[];

interface FileGrantAddRowProps {
  folderId: string;
  levelOptions: Array<SelectOption<FileGrantLevel>>;
}

/** 新增一筆授權：對象種類 ＋ 搜尋對象（伺服器端搜尋）＋ 等級 ＋ 期限（可不填）。 */
export function FileGrantAddRow({ folderId, levelOptions }: FileGrantAddRowProps) {
  const { t } = useTranslation();
  const [subjectType, setSubjectType] = useState<FileGrantSubjectType>('role');
  // 租戶沒有啟用 `group` 時不能授權給群組（docs/architecture/iam/07-groups.md §8）
  const hasGroups = useIsFeatureReady(TenantFeature.group);
  const subjectTypes = hasGroups ? SUBJECT_TYPES : SUBJECT_TYPES.filter((type) => type !== 'group');
  const [keyword, setKeyword] = useState('');
  const debounced = useDebouncedValue(keyword.trim(), SUBJECT_SEARCH_DEBOUNCE_MS);
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
            // 選的日期在偏好時區的那一天結束時過期（與其他畫面顯示的日期一致，不是瀏覽器的時區）
            expiresAt: expiresOn ? zonedDayBoundary(expiresOn, 'end') : null,
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
        options={subjectTypes.map((type) => ({
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
        min={todayInZone()}
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
