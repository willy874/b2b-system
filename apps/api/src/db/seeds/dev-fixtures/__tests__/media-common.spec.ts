import { describe, expect, it } from 'vitest';

import { FILE_IMAGE_VARIANTS_JOB } from '@/modules/file/file-image.service';
import { GALLERY_PROCESS_JOB } from '@/modules/gallery/gallery-process.job';
import { IMAGE_PROCESS_JOB } from '@/modules/image/image-process.job';
import { USER_AVATAR_USAGE } from '@/modules/user/user-avatar.service';

import { AVATAR_USAGE, AVATAR_USERS, avatarSpec } from '../avatars';
import { MEDIA_FILES, MEDIA_FOLDERS } from '../files';
import { SEED_JOB } from '../media-common';

/** seed 以字面量入列與登記用途：與模組的定義不一致時，worker 不認得那些工作、頭像也處理不了。 */
describe('dev seed 的工作名稱與用途', () => {
  it('與各模組的工作定義相同', () => {
    expect(SEED_JOB.GALLERY_PROCESS).toBe(GALLERY_PROCESS_JOB.name);
    expect(SEED_JOB.IMAGE_PROCESS).toBe(IMAGE_PROCESS_JOB.name);
    expect(SEED_JOB.FILE_IMAGE_VARIANTS).toBe(FILE_IMAGE_VARIANTS_JOB.name);
  });

  it('頭像的用途與 modules/user 登記的相同', () => {
    expect(AVATAR_USAGE).toBe(USER_AVATAR_USAGE);
  });
});

describe('dev seed 的檔案與頭像規劃', () => {
  it('檔案所在的資料夾都有建立；上層先出現', () => {
    const folders = new Set<string>(['對外簡報']);
    for (const path of MEDIA_FOLDERS) {
      const slash = path.lastIndexOf('/');
      if (slash !== -1) expect(folders).toContain(path.slice(0, slash));
      folders.add(path);
    }
    for (const file of MEDIA_FILES) expect(folders).toContain(file.folder);
  });

  it('有照片也有 PDF、SVG（「加入圖片庫」要略過非點陣圖）；key 不重複', () => {
    const kinds = new Set(MEDIA_FILES.map((file) => file.content.kind));
    expect([...kinds].toSorted()).toEqual(['pdf', 'photo', 'svg']);
    expect(new Set(MEDIA_FILES.map((file) => file.key)).size).toBe(MEDIA_FILES.length);
  });

  it('頭像至少 128 × 128（user.avatar 的最小尺寸），使用者序號在 dev01～dev50', () => {
    for (const serial of AVATAR_USERS) {
      expect(serial).toBeGreaterThanOrEqual(1);
      expect(serial).toBeLessThanOrEqual(50);
      const spec = avatarSpec(serial);
      expect(Math.min(spec.width, spec.height)).toBeGreaterThanOrEqual(128);
    }
  });
});
