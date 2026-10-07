import * as Pages from './pages';
import * as Routes from './routes';

Routes.AnnouncementListRoute.update({ component: Pages.AsyncAnnouncementListPage });
Routes.AnnouncementCreateRoute.update({ component: Pages.AsyncAnnouncementCreatePage });
Routes.AnnouncementDetailRoute.update({ component: Pages.AsyncAnnouncementDetailPage });
Routes.AnnouncementMessageRoute.update({ component: Pages.AsyncAnnouncementMessagePage });

export { Routes };
export { ANNOUNCEMENT_FEATURE } from './routes';
export {
  ANNOUNCEMENT_CREATE_PAGE,
  ANNOUNCEMENT_MESSAGE_PAGE,
  ANNOUNCEMENT_PAGE,
  registerAnnouncementPagePermissions,
} from './permission';
export { appContextPlugin as announcementFeaturePlugin } from './plugin';
export { registerAnnouncementNavigation } from './navigation';
