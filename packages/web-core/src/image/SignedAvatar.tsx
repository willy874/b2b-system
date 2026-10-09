import { Avatar } from '@b2b-system/ui/Avatar';
import type { AvatarProps } from '@b2b-system/ui/Avatar';

import { SignedImage } from './SignedImage';
import type { ImageSources } from './types';

export interface SignedAvatarProps extends Omit<AvatarProps, 'src' | 'image'> {
  /** api 回應裡的頭像；`null` 代表沒有設定頭像，只顯示名字縮寫。 */
  sources: ImageSources | null | undefined;
  /** 具名的版本（頭像的用途宣告 `sm`、`md`、`lg`），依顯示的大小挑選。 */
  variant: string;
  /** 見 `SignedImage` 的 `onExpired`。 */
  onExpired?: () => void;
}

/**
 * 有簽章網址的頭像（docs/architecture/backend/25-image.md §5）：`Avatar` 的 `image` 插槽填入 `SignedImage`，
 * 圖片還沒載入或失敗時露出名字縮寫。`@b2b-system/ui` 不認識 `ImageSources`，所以組合放在 web-core。
 */
export function SignedAvatar({ sources, variant, onExpired, name, ...rest }: SignedAvatarProps) {
  return (
    <Avatar
      {...rest}
      name={name}
      image={
        sources ? (
          <SignedImage sources={sources} variant={variant} alt={name} onExpired={onExpired} />
        ) : null
      }
    />
  );
}
