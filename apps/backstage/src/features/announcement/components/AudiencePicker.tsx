import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getAnnouncementAudiencePreviewQueryOptions } from '@/apis/announcement/preview-announcement-audience/query';
import { getGroupOptionsQueryOptions } from '@/apis/group/get-group-list/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { getUserDetailQueryOptions } from '@/apis/user/get-user-detail/query';
import { getUserListQueryOptions } from '@/apis/user/get-user-list/query';
import { Field } from '@/components/Field';
import { Select } from '@/components/Select';
import { Switch } from '@/components/Switch';
import { useTranslation } from '@/core/locales';
import type { AnnouncementAudience } from '@/shared/api-sdk';

/** 使用者搜尋的輸入停頓多久才查詢（與群組成員的搜尋相同）。 */
const USER_SEARCH_DEBOUNCE_MS = 250;

interface AudiencePickerProps {
  value: AnnouncementAudience;
  onChange: (value: AnnouncementAudience) => void;
  disabled?: boolean;
}

/**
 * 受眾（docs/adr/0031-announcements.md D5）：全租戶，或使用者、群組、角色的聯集。下方即時顯示「現在送出會收到幾人」
 * （伺服器解析，含巢狀群組；不扣除送出者自己）。使用者在伺服器端搜尋；群組與角色數量少，一次抓回本地過濾。
 */
export function AudiencePicker({ value, onChange, disabled }: AudiencePickerProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword.trim()), USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);

  const users = useQuery(
    getUserListQueryOptions({ params: { offset: 0, limit: 20, keyword: debounced || undefined } }),
  );
  const groups = useQuery(getGroupOptionsQueryOptions());
  const roles = useQuery(getRoleOptionsQueryOptions());
  const preview = useQuery(getAnnouncementAudiencePreviewQueryOptions(value));

  // 已選、但不在目前搜尋結果裡的使用者（編輯既有的公告）：另外取名稱，標籤才顯示得出來
  const searched = users.data?.items ?? [];
  const missing = value.userIds.filter((id) => !searched.some((user) => user.id === id));
  const named = useQueries({
    queries: missing.map((id) => getUserDetailQueryOptions(id)),
    combine: (results) => results.flatMap((result) => (result.data ? [result.data] : [])),
  });
  const seen = new Set<string>();
  const userOptions = [...named, ...searched].flatMap((user) => {
    if (seen.has(user.id)) return [];
    seen.add(user.id);
    return [{ value: user.id, label: user.displayName, description: user.email }];
  });

  return (
    <div className="flex flex-col gap-3" data-testid="announcement-audience">
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={value.all}
          disabled={disabled}
          onCheckedChange={(all) => onChange({ ...value, all })}
          aria-label={t('announcement.audience.all')}
          data-testid="announcement-audience-all"
        />
        {t('announcement.audience.all')}
      </label>
      {!value.all && (
        <>
          <Field label={t('announcement.audience.users')}>
            <Select
              multiple
              options={userOptions}
              value={value.userIds}
              onValueChange={(userIds) => onChange({ ...value, userIds })}
              searchable
              searchValue={keyword}
              onSearchChange={setKeyword}
              filterOption={false}
              loading={users.isFetching}
              disabled={disabled}
              placeholder={t('announcement.audience.usersPlaceholder')}
              noMatchLabel={t('announcement.audience.noMatch')}
              data-testid="announcement-audience-users"
            />
          </Field>
          <Field label={t('announcement.audience.groups')}>
            <Select
              multiple
              options={(groups.data?.items ?? []).map((group) => ({
                value: group.id,
                label: group.name,
              }))}
              value={value.groupIds}
              onValueChange={(groupIds) => onChange({ ...value, groupIds })}
              searchable
              loading={groups.isFetching}
              disabled={disabled}
              placeholder={t('announcement.audience.groupsPlaceholder')}
              noMatchLabel={t('announcement.audience.noMatch')}
              data-testid="announcement-audience-groups"
            />
          </Field>
          <Field label={t('announcement.audience.roles')}>
            <Select
              multiple
              options={(roles.data?.items ?? []).map((role) => ({
                value: role.id,
                label: role.name,
              }))}
              value={value.roleIds}
              onValueChange={(roleIds) => onChange({ ...value, roleIds })}
              searchable
              loading={roles.isFetching}
              disabled={disabled}
              placeholder={t('announcement.audience.rolesPlaceholder')}
              noMatchLabel={t('announcement.audience.noMatch')}
              data-testid="announcement-audience-roles"
            />
          </Field>
        </>
      )}
      <p
        className="m-0 text-sm text-[var(--color-fg-muted)]"
        data-testid="announcement-audience-count"
      >
        {preview.data
          ? t('announcement.audience.count', { count: preview.data.count })
          : t('announcement.audience.counting')}
      </p>
    </div>
  );
}
