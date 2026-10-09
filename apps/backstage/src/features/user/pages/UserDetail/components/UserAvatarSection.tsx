import { Avatar } from '@b2b-system/ui/Avatar';
import { coalesce, SignedAvatar } from '@b2b-system/web-core/image';
import { ImageField } from '@b2b-system/web-core/image-picker';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo } from 'react';

import { USER_AVATAR_USAGE } from '@/apis/image/types';
import { invalidateResources, Resource } from '@/apis/resources';
import type { User } from '@/shared/api-sdk';

import { useUserAvatarMutation } from '../../../hooks/useUserMutations';

interface UserAvatarSectionProps {
  user: User;
  /** `user:update`：可以幫他換頭像。 */
  canUpdate: boolean;
}

/**
 * 使用者的頭像（docs/architecture/frontend/23-image-picker.md §8）：有 `user:update` 的人可以幫他換；
 * 圖片從自己的上傳、最近使用或檔案管理挑選。重新裁切要主檔，只有上傳那張圖的人拿得到。
 */
export function UserAvatarSection({ user, canUpdate }: UserAvatarSectionProps) {
  const { t } = useTranslation();
  const updateAvatar = useUserAvatarMutation();
  const onExpired = useMemo(
    () =>
      coalesce(() =>
        invalidateResources([{ resource: Resource.USER, kind: 'update', id: user.id }]),
      ),
    [user.id],
  );

  return (
    <section className="flex flex-col gap-2" aria-labelledby="user-avatar-title">
      <h3 id="user-avatar-title" className="m-0 text-sm font-medium">
        {t('user.avatar.title')}
      </h3>
      {canUpdate ? (
        <ImageField
          usage={USER_AVATAR_USAGE}
          value={user.avatar}
          assetId={user.avatarImageId}
          variant="lg"
          alt={user.displayName}
          shape="circle"
          size={80}
          fallback={<Avatar name={user.displayName} size={80} />}
          pending={updateAvatar.isPending}
          onChange={({ assetId }) =>
            updateAvatar.mutate({
              params: { userId: user.id, body: { avatarImageId: assetId, version: user.version } },
            })
          }
          onRecrop={(crop) =>
            updateAvatar.mutate({
              params: { userId: user.id, body: { avatarCrop: crop, version: user.version } },
            })
          }
          onExpired={onExpired}
          data-testid="user-avatar"
        />
      ) : (
        <SignedAvatar
          sources={user.avatar}
          variant="lg"
          name={user.displayName}
          size={80}
          onExpired={onExpired}
          data-testid="user-avatar"
        />
      )}
    </section>
  );
}
