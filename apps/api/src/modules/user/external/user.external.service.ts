import { Injectable } from '@nestjs/common';

import type { UserDto } from '../dto/user.dto';
import { UserService } from '../user.service';
import type {
  ExternalUserDto,
  ExternalUserListDto,
  ListExternalUserDto,
} from './user.external.dto';

function toExternalUser(user: UserDto): ExternalUserDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    roles: user.roles.map(({ id, slug, name }) => ({ id, slug, name })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** 對外 API 的使用者（唯讀，docs/adr/0027-api-tokens-external-api.md T3）：查詢在 `UserService`，這裡只換成對外的契約。 */
@Injectable()
export class UserExternalService {
  constructor(private readonly users: UserService) {}

  async list(query: ListExternalUserDto): Promise<ExternalUserListDto> {
    const result = await this.users.list({
      offset: query.offset,
      limit: query.limit,
      keyword: query.keyword,
      status: query.status ? [query.status] : undefined,
      sort: [{ sort: 'createdAt', order: 'desc' }],
    });
    return { items: result.items.map(toExternalUser), pagination: result.pagination };
  }

  async findOne(id: string): Promise<ExternalUserDto> {
    return toExternalUser(await this.users.findOne(id));
  }
}
