import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getFileFolderGrantControllerSearchSubjectsUrl } from '@/shared/api-sdk';
import type { FileGrantSubjectList } from '@/shared/api-sdk';

import type { FileGrantSubjectType } from '../types';

export interface FileGrantSubjectParams {
  folderId: string;
  subjectType: FileGrantSubjectType;
  keyword?: string;
}

export const fetchFileGrantSubjectListQuery = defineAuthFetcher<
  HttpRequestDTO<FileGrantSubjectParams>,
  FileGrantSubjectList
>((http, request) => {
  const { folderId, ...query } = request.params;
  return http.request(
    withQuery(getFileFolderGrantControllerSearchSubjectsUrl({ id: folderId }), query),
    { method: 'GET' },
  );
});
