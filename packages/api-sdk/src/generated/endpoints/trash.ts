// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { TrashItem } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /trash

export interface TrashControllerListResponses {
  200: {
    data: {
      items: Array<TrashItem>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type TrashControllerListResponse = TrashControllerListResponses[200];

export type TrashControllerListResult = ApiResponse<200, TrashControllerListResponses[200]>;

export function getTrashControllerListUrl(): string {
  return buildUrl('/trash');
}
