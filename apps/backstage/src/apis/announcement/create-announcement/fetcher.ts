import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAnnouncementControllerCreateUrl } from '@/shared/api-sdk';
import type { Announcement, CreateAnnouncementRequest } from '@/shared/api-sdk';

export const fetchAnnouncementCreateMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: CreateAnnouncementRequest }>,
  Announcement
>((http, request) =>
  http.request(
    getAnnouncementControllerCreateUrl(),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
