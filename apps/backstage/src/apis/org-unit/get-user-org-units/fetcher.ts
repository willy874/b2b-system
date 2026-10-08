import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserOrgUnitControllerListOfUserUrl } from '@/shared/api-sdk';
import type { UserOrgUnits } from '@/shared/api-sdk';

export const fetchUserOrgUnitsQuery = defineAuthFetcher<
  HttpRequestDTO<{ userId: string }>,
  UserOrgUnits
>((http, request) =>
  http.request(getUserOrgUnitControllerListOfUserUrl({ id: request.params.userId }), {
    method: 'GET',
  }),
);
