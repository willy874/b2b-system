import { Button, IconButton } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { Pagination } from '@b2b-system/ui/Pagination';
import { Select } from '@b2b-system/ui/Select';
import { QuerySection, useOffsetClamp } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { getGroupOptionsQueryOptions } from '@/apis/group/get-group-list/query';
import { getGroupMembersQueryOptions } from '@/apis/group/get-group-members/query';
import { getUserListQueryOptions } from '@/apis/user/get-user-list/query';
import type { GroupMember } from '@/shared/api-sdk';

import { useGroupMembersUpdateMutation } from '../../../hooks/useGroupMutations';
import { GroupDetailRoute, GroupListRoute } from '../../../routes';

/** 移除的確認說明：成員是群組時，裡面的人也一起失去這個群組帶來的角色。 */
const REMOVE_CONFIRM_KEY = {
  user: 'group.member.removeConfirm.user',
  group: 'group.member.removeConfirm.group',
} as const satisfies Record<GroupMember['type'], string>;

/** 使用者搜尋的輸入停頓多久才查詢（與資料夾共用對話框相同）。 */
const USER_SEARCH_DEBOUNCE_MS = 250;
/** 成員一頁幾位 */
const MEMBER_PAGE_SIZE = 50;

interface GroupMemberSectionProps {
  groupId: string;
  /** 群組的直接成員數（群組詳情的 `memberCount`）：標題用它，搜尋時也不變 */
  memberCount: number;
  /** 有 group:update：可以加入與移除 */
  canEdit: boolean;
}

/**
 * 群組的直接成員：使用者，以及巢狀的群組（它的成員都算這個群組的成員）。
 * 加入的成員取得這個群組與上層群組的角色（反提權、循環、層數都由後端檢查，錯誤以 toast 顯示）。
 * 分頁並可搜尋：只列前幾十位會讓後面的人看不到也移除不了。
 */
export function GroupMemberSection({ groupId, memberCount, canEdit }: GroupMemberSectionProps) {
  const { t } = useTranslation();
  const search = GroupListRoute.useSearch();
  const updateMembers = useGroupMembersUpdateMutation();
  const confirm = useConfirm();
  const [offset, setOffset] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(keyword.trim());
      setOffset(0);
    }, USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);
  const members = useQuery(
    getGroupMembersQueryOptions({
      groupId,
      offset,
      limit: MEMBER_PAGE_SIZE,
      keyword: debounced || undefined,
    }),
  );
  useOffsetClamp(members.data?.pagination.total, offset, MEMBER_PAGE_SIZE, setOffset);

  // 沒有復原，而且移除子群組會讓裡面所有人失去這個群組的角色：先說明影響再送出
  const remove = (member: GroupMember) =>
    void confirm({
      title: t('group.member.removeTitle'),
      description: t(REMOVE_CONFIRM_KEY[member.type], { name: member.name }),
      confirmLabel: t('group.member.removeAction'),
      tone: 'danger',
      onConfirm: () =>
        updateMembers.mutateAsync({
          params: { groupId, body: { add: [], remove: [{ type: member.type, id: member.id }] } },
        }),
      'data-testid': 'group-member-remove-confirm',
    });

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">
        {t('group.detail.members', { count: memberCount })}
      </h3>
      {(memberCount > MEMBER_PAGE_SIZE || keyword) && (
        <Input
          className="mt-2"
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('group.member.searchPlaceholder')}
          aria-label={t('group.member.searchPlaceholder')}
          data-testid="group-member-search"
        />
      )}
      <div className="mt-2">
        <QuerySection query={members} data-testid="group-member-error">
          {({ items, pagination }) => (
            <>
              <ul
                className="flex list-none flex-col gap-1 p-0 text-sm"
                data-testid="group-member-list"
              >
                {items.length ? (
                  items.map((member) => (
                    <li
                      key={`${member.type}:${member.id}`}
                      className="flex items-center gap-2"
                      data-testid="group-member"
                      data-value={member.id}
                    >
                      <Icon name={member.type === 'group' ? 'users' : 'user'} size={14} />
                      {member.type === 'group' ? (
                        <Link
                          to={GroupDetailRoute.to}
                          params={{ groupId: member.id }}
                          search={search}
                          className="text-[var(--color-brand)]"
                        >
                          {member.name}
                        </Link>
                      ) : (
                        <RouteLink
                          to="user.detail"
                          params={{ userId: member.id }}
                          className="text-[var(--color-brand)]"
                        >
                          {member.name}
                        </RouteLink>
                      )}
                      {member.email && (
                        <span className="text-[var(--color-fg-muted)]">{member.email}</span>
                      )}
                      {canEdit && (
                        <IconButton
                          size="sm"
                          className="ml-auto"
                          aria-label={t('group.member.remove', { name: member.name })}
                          disabled={updateMembers.isPending}
                          onClick={() => remove(member)}
                          data-testid="group-member-remove"
                          data-value={member.id}
                        >
                          <Icon name="close" size={14} />
                        </IconButton>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="text-[var(--color-fg-muted)]">
                    {debounced ? t('group.member.noMatch') : t('common.none')}
                  </li>
                )}
              </ul>
              {pagination.total > MEMBER_PAGE_SIZE && (
                <Pagination
                  className="mt-2"
                  offset={offset}
                  limit={MEMBER_PAGE_SIZE}
                  pageSizeOptions={[MEMBER_PAGE_SIZE]}
                  total={pagination.total}
                  onChange={(next) => setOffset(next.offset)}
                  data-testid="group-member-pagination"
                />
              )}
            </>
          )}
        </QuerySection>
      </div>
      {canEdit && <AddMemberRow groupId={groupId} />}
    </section>
  );
}

type MemberType = GroupMember['type'];

/** 加入一位成員：種類（使用者／群組）＋ 搜尋對象。使用者在伺服器端搜尋；群組數量少，一次抓回本地過濾。 */
function AddMemberRow({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const [type, setType] = useState<MemberType>('user');
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [memberId, setMemberId] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword.trim()), USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);
  const users = useQuery({
    ...getUserListQueryOptions({
      params: { offset: 0, limit: 20, keyword: debounced || undefined },
    }),
    enabled: type === 'user',
  });
  const groups = useQuery({ ...getGroupOptionsQueryOptions(), enabled: type === 'group' });
  const updateMembers = useGroupMembersUpdateMutation();

  const options =
    type === 'user'
      ? (users.data?.items ?? []).map((user) => ({
          value: user.id,
          label: user.displayName,
          description: user.email,
        }))
      : (groups.data?.items ?? [])
          // 不能把群組加進自己（其他循環由後端擋）
          .filter((group) => group.id !== groupId)
          .map((group) => ({ value: group.id, label: group.name }));

  const submit = () => {
    if (!memberId) return;
    updateMembers.mutate(
      { params: { groupId, body: { add: [{ type, id: memberId }], remove: [] } } },
      { onSuccess: () => setMemberId(null) },
    );
  };

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <Select
        className="w-28"
        aria-label={t('group.member.typeLabel')}
        options={[
          { value: 'user' as const, label: t('group.member.type.user') },
          { value: 'group' as const, label: t('group.member.type.group') },
        ]}
        value={type}
        onValueChange={(next) => {
          setType(next);
          setMemberId(null);
          setKeyword('');
        }}
        data-testid="group-member-type"
      />
      <Select
        className="min-w-48 flex-1"
        aria-label={t('group.member.target')}
        placeholder={t('group.member.placeholder')}
        options={options}
        value={memberId}
        onValueChange={setMemberId}
        searchable
        {...(type === 'user'
          ? { searchValue: keyword, onSearchChange: setKeyword, filterOption: false as const }
          : {})}
        noMatchLabel={t('group.member.noMatch')}
        loading={type === 'user' ? users.isFetching : groups.isFetching}
        data-testid="group-member-target"
      />
      <Button
        variant="primary"
        disabled={!memberId}
        loading={updateMembers.isPending}
        onClick={submit}
        data-testid="group-member-add"
      >
        {t('group.member.add')}
      </Button>
    </div>
  );
}
