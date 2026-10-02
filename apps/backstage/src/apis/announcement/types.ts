import type { Announcement } from '@/shared/api-sdk';

export interface AnnouncementListParams {
  offset: number;
  limit: number;
  keyword?: string;
  status?: Announcement['status'];
}

export interface AnnouncementDispatchListParams {
  announcementId: string;
  offset: number;
  limit: number;
}
