import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAnnouncementControllerListTriggerEventsUrl } from '@/shared/api-sdk';
import type { AnnouncementTriggerEventList } from '@/shared/api-sdk';

export const fetchAnnouncementTriggerEventsQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  AnnouncementTriggerEventList
>((http) => http.request(getAnnouncementControllerListTriggerEventsUrl(), { method: 'GET' }));
