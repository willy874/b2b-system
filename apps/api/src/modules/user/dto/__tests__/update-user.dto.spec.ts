import { describe, expect, it } from 'vitest';

import { UpdateProfileSchema } from '@/modules/auth/dto/auth.dto';

import { UpdateUserSchema } from '../update-user.dto';

describe('時區偏好的驗證（UpdateUserRequest、UpdateProfileRequest）', () => {
  it('管理者改使用者的時區：不認得的時區被拒絕', () => {
    expect(UpdateUserSchema.safeParse({ timezone: 'Mars/Olympus', version: 1 }).success).toBe(
      false,
    );
    expect(UpdateUserSchema.safeParse({ timezone: 'Asia/Tokyo', version: 1 }).success).toBe(true);
  });

  it('自己改偏好：不認得的時區被拒絕', () => {
    expect(
      UpdateProfileSchema.safeParse({ preferences: { timezone: 'Mars/Olympus' } }).success,
    ).toBe(false);
    expect(
      UpdateProfileSchema.safeParse({ preferences: { timezone: 'Europe/Paris' } }).success,
    ).toBe(true);
  });
});
