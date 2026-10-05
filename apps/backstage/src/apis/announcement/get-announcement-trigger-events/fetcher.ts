import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAnnouncementControllerListTriggerEventsUrl } from '@/shared/api-sdk';
import type { AnnouncementTriggerEventList } from '@/shared/api-sdk';

export const fetchAnnouncementTriggerEventsQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  AnnouncementTriggerEventList
>((http) => http.request(getAnnouncementControllerListTriggerEventsUrl(), { method: 'GET' }));
