import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AuthzService, parseSubjectKey, withClosurePath } from '@/core/authz';
import type { AuthzPath, SubjectKey } from '@/core/authz';
import { AppException } from '@/core/errors';
import { AuthzExplainService } from '@/modules/authz-explain/authz-explain.service';

import type { FileAccessExplainDto } from './dto/file-access-explain.dto';
import { FILE_ACTIONS } from './file-access.context';
import { FileAccessService } from './file-access.service';
import { FileFolderRepository } from './file-folder.repository';

/**
 * 「某人為什麼能（不能）在這個資料夾做 X」（ADR-0024 G4b）：以目標使用者建立判斷器取路徑，接上主體閉包的來歷，
 * 再依 **操作者** 遮蔽讀不到的節點（D14）——資料夾讀不讀得到看操作者在那個資料夾的 `can_read`。
 * 查自己不需要權限；查別人要 `authz:explain`。
 */
@Injectable()
export class FileAccessExplainService {
  constructor(
    private readonly access: FileAccessService,
    private readonly folders: FileFolderRepository,
    private readonly authz: AuthzService,
    private readonly explain: AuthzExplainService,
  ) {}

  async explainFolder(
    folderId: string,
    userId: string,
    actor: AuthUser,
  ): Promise<FileAccessExplainDto> {
    await this.explain.assertCanExplain(actor, userId, 'GET /file-folders/:id/explain');
    await this.explain.assertUserExists(userId);
    const [target, viewer, closure] = await Promise.all([
      this.access.contextFor({ id: userId }),
      this.access.contextFor(actor),
      this.authz.closurePaths(userId),
    ]);
    if (!target.exists(folderId)) throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId });

    const paths = FILE_ACTIONS.map((action) => {
      const path = target.explain(action, folderId);
      return path ? withClosurePath(path, closure) : null;
    });
    const found = paths.filter((path): path is AuthzPath => path !== null);
    const described = await this.explain.describePaths(actor, found, async (keys) => {
      const folderIds = keys
        .map((key) => parseSubjectKey(key).object)
        .filter((object) => object.type === 'fileFolder')
        .map((object) => object.id);
      const rows = await this.folders.findByIds(folderIds);
      const names = new Map(rows.map((row) => [row.id, row.name]));
      return new Map(
        keys.flatMap((key): Array<[SubjectKey, { name: string | null; visible: boolean }]> => {
          const { object } = parseSubjectKey(key);
          return object.type === 'fileFolder'
            ? [
                [
                  key,
                  { name: names.get(object.id) ?? null, visible: viewer.can('read', object.id) },
                ],
              ]
            : [];
        }),
      );
    });

    let next = 0;
    return {
      folderId,
      userId,
      actions: FILE_ACTIONS.map((action, index) => {
        const allowed = paths[index] !== null;
        return { action, allowed, path: allowed ? (described[next++] ?? null) : null };
      }),
    };
  }
}
