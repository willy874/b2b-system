import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaPolicyControllerPreviewUrl } from '@/shared/api-sdk';
import type { MfaPolicyImpact, UpdateMfaPolicyRequest } from '@/shared/api-sdk';

/** 套用前先看影響：不符合政策的人數、會被擋在門外的人數。 */
export const fetchPreviewMfaPolicyMutation = defineAuthFetcher<
  HttpRequestDTO<UpdateMfaPolicyRequest>,
  MfaPolicyImpact
>((http, { params }) =>
  http.request(getMfaPolicyControllerPreviewUrl(), jsonBody(params, { method: 'POST' })),
);
