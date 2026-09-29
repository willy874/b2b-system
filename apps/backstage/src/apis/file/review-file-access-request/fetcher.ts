import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import {
  getFileFolderGrantControllerApproveAccessRequestUrl,
  getFileFolderGrantControllerRejectAccessRequestUrl,
} from '@/shared/api-sdk';
import type { ReviewFileAccessRequest } from '@/shared/api-sdk';

export interface FileAccessReviewParams {
  workspaceId: string;
  folderId: string;
  requestId: string;
  decision: 'approve' | 'reject';
  body: ReviewFileAccessRequest;
}

/** 核准（＝授予申請的等級）或駁回一筆存取申請。 */
export const fetchFileAccessRequestReviewMutation = defineAuthFetcher<
  HttpRequestDTO<FileAccessReviewParams>,
  undefined
>((http, { params }) => {
  const path = {
    workspaceId: params.workspaceId,
    id: params.folderId,
    requestId: params.requestId,
  };
  const url =
    params.decision === 'approve'
      ? getFileFolderGrantControllerApproveAccessRequestUrl(path)
      : getFileFolderGrantControllerRejectAccessRequestUrl(path);
  return http.request(url, jsonBody(params.body, { method: 'POST' }));
});
