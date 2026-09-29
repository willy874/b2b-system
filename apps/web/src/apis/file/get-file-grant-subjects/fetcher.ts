import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderGrantControllerSearchSubjectsUrl } from '@/shared/api-sdk';
import type { FileGrantSubjectList } from '@/shared/api-sdk';

import type { FileGrantSubjectType } from '../types';

export interface FileGrantSubjectParams {
  workspaceId: string;
  folderId: string;
  subjectType: FileGrantSubjectType;
  keyword?: string;
}

export const fetchFileGrantSubjectListQuery = defineAuthFetcher<
  HttpRequestDTO<FileGrantSubjectParams>,
  FileGrantSubjectList
>((http, request) => {
  const { workspaceId, folderId, ...query } = request.params;
  return http.request(
    withQuery(getFileFolderGrantControllerSearchSubjectsUrl({ workspaceId, id: folderId }), query),
    { method: 'GET' },
  );
});
