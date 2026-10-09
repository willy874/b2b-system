import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { ImageAssetService } from '@/modules/image/image-asset.service';

import { USER_AVATAR_USAGE, UserAvatarService } from '../user-avatar.service';
import type { UserRepository } from '../user.repository';

const USER = 'uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu';
const ACTOR = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as AuthUser;
const OWNER = { ownerType: 'user', ownerId: USER };
const CROP = { x: 0, y: 0, width: 0.5, height: 0.5 };

function setup(current: string | null) {
  const images = {
    registerUsage: vi.fn(),
    registerOwner: vi.fn(),
    claim: vi.fn(async () => ({ source: 'file', sourceRefId: 'f1' })),
    describeSource: vi.fn((row: { source: string; sourceRefId: string | null }) => row),
    detach: vi.fn(async () => undefined),
    detachAll: vi.fn(async () => undefined),
    recrop: vi.fn(async () => undefined),
    sourcesOf: vi.fn(
      async () => new Map([['new', { width: 1, height: 1, expiresAt: '', variants: {} }]]),
    ),
  };
  const repo = {
    lockAvatar: vi.fn(async () => ({ avatarImageId: current })),
    listRoles: vi.fn(async () => [{ id: 'r1' }]),
  };
  const events = { publish: vi.fn() };
  const service = new UserAvatarService(
    images as unknown as ImageAssetService,
    repo as unknown as UserRepository,
    events as unknown as DomainEventBus,
  );
  return { service, images, repo, events };
}

describe('UserAvatarService（頭像，docs/architecture/backend/25-image.md §15.8）', () => {
  it('登記用途（1:1、sm/md/lg、12 小時）與擁有者；處理好時推使用者的更新給看得到的人與本人', async () => {
    const { service, images, events } = setup(null);
    service.onModuleInit();
    expect(images.registerUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: USER_AVATAR_USAGE,
        aspectRatio: 1,
        presets: { sm: 32, md: 96, lg: 256 },
        urlTtl: 43_200,
      }),
    );
    const [[owner]] = images.registerOwner.mock.calls as unknown as [
      [{ onImageReady: (id: string) => Promise<void> }],
    ];
    await owner.onImageReady(USER);
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'user', kind: 'update', id: USER, refs: { role: ['r1'] } }],
      affectedUserIds: [USER],
    });
  });

  it('沒有要改頭像 → undefined，不鎖列', async () => {
    const { service, repo } = setup('old');
    expect(await service.applyInTx(USER, {}, ACTOR, 'tx' as never)).toBeUndefined();
    expect(repo.lockAvatar).not.toHaveBeenCalled();
  });

  it('換一張：鎖住使用者列、解除舊的、認領新的；稽核記下來源', async () => {
    const { service, images, repo } = setup('old');
    const result = await service.applyInTx(
      USER,
      { imageId: 'new', crop: CROP },
      ACTOR,
      'tx' as never,
    );
    expect(repo.lockAvatar).toHaveBeenCalledWith(USER, 'tx');
    expect(images.detach).toHaveBeenCalledWith('old', OWNER, 'tx');
    expect(images.claim).toHaveBeenCalledWith('new', OWNER, USER_AVATAR_USAGE, CROP, ACTOR, 'tx');
    expect(result).toEqual({
      avatarImageId: 'new',
      audit: {
        before: { avatarImageId: 'old' },
        after: {
          avatarImageId: 'new',
          avatarSource: 'file',
          avatarSourceRefId: 'f1',
          avatarCrop: CROP,
        },
      },
    });
  });

  it('拿掉頭像（null）：只解除舊的', async () => {
    const { service, images } = setup('old');
    const result = await service.applyInTx(USER, { imageId: null }, ACTOR, 'tx' as never);
    expect(images.claim).not.toHaveBeenCalled();
    expect(result?.avatarImageId).toBeNull();
  });

  it('只帶裁切：重新裁切目前那張；沒有頭像時 VALIDATION_FAILED', async () => {
    const withAvatar = setup('old');
    await withAvatar.service.applyInTx(USER, { crop: CROP }, ACTOR, 'tx' as never);
    expect(withAvatar.images.recrop).toHaveBeenCalledWith('old', OWNER, CROP, 'tx');

    const without = setup(null);
    const error = await without.service
      .applyInTx(USER, { crop: CROP }, ACTOR, 'tx' as never)
      .catch((caught: unknown) => caught);
    expect((error as AppException).code).toBe('VALIDATION_FAILED');
  });

  it('使用者不存在 → USER_NOT_FOUND', async () => {
    const ctx = setup(null);
    ctx.repo.lockAvatar.mockResolvedValueOnce(undefined as never);
    const error = await ctx.service
      .applyInTx(USER, { imageId: 'new' }, ACTOR, 'tx' as never)
      .catch((caught: unknown) => caught);
    expect((error as AppException).code).toBe('USER_NOT_FOUND');
  });

  it('avatarsOf：沒有頭像的是 null', async () => {
    const { service } = setup(null);
    const avatars = await service.avatarsOf([
      { id: 'a', avatarImageId: 'new' },
      { id: 'b', avatarImageId: null },
    ]);
    expect(avatars.get('a')).not.toBeNull();
    expect(avatars.get('b')).toBeNull();
  });
});
