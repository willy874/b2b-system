import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getWebhookControllerUrlLimitUrl } from '@/shared/api-sdk';
import type { WebhookUrlLimit } from '@/shared/api-sdk';

export interface WebhookUrlLimitParams {
  /** 正在編輯的訂閱；新建時不帶。 */
  subscriptionId?: string;
}

export const fetchWebhookUrlLimitQuery = defineAuthFetcher<
  HttpRequestDTO<WebhookUrlLimitParams>,
  WebhookUrlLimit
>((http, request) =>
  http.request(withQuery(getWebhookControllerUrlLimitUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
