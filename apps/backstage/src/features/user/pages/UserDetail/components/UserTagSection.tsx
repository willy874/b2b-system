import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';
import { Button } from '@/components/Button';
import { TagAssignDialog, TagChips } from '@/core/components';
import { useTranslation } from '@/core/locales';
import type { User } from '@/shared/api-sdk';

import { useUserTagsReplaceMutation } from '../../../hooks/useUserMutations';

interface UserTagSectionProps {
  user: Pick<User, 'id' | 'email' | 'tags'>;
  /** 貼與移除跟著 `user:update`（docs/adr/0032-tags.md D5）。 */
  canEdit: boolean;
}

/** 使用者的標籤（`user` 標籤組）：看得到使用者就看得到；能編輯使用者才能貼與移除。 */
export function UserTagSection({ user, canEdit }: UserTagSectionProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const options = useQuery({ ...getTagListQueryOptions('user'), enabled: editing });
  const replace = useUserTagsReplaceMutation();

  return (
    <section data-testid="user-tag-section">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('user.field.tags')}</h3>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing(true)} data-testid="user-tag-edit-button">
            {t('common.edit')}
          </Button>
        )}
      </div>
      <div className="mt-2">
        <TagChips
          tags={user.tags}
          empty={<span className="text-sm text-[var(--color-fg-muted)]">{t('common.none')}</span>}
          data-testid="user-tags"
        />
      </div>
      <TagAssignDialog
        open={editing}
        onOpenChange={setEditing}
        title={t('tag.assign.title', { name: user.email })}
        options={options.data?.items}
        value={user.tags}
        onSave={(tagIds) =>
          replace.mutateAsync({ params: { resourceType: 'user', resourceId: user.id, tagIds } })
        }
      />
    </section>
  );
}
