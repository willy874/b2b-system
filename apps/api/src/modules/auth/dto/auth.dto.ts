import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { PermissionKeySchema } from '@/modules/permission/dto/permission.dto';
import { RoleSummarySchema, UserStatusSchema } from '@/modules/user/dto/user.dto';

import { PasswordSchema } from '../password';

export const LoginSchema = defineSchema(
  'LoginRequest',
  z.object({
    email: z.string().trim().email().max(255),
    password: z.string().min(1).max(128),
  }),
);

export const SessionSchema = defineSchema(
  'Session',
  z.object({
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int(),
  }),
);

export const ProfileSchema = defineSchema(
  'Profile',
  z.object({
    user: z.object({
      id: z.string().uuid(),
      email: z.string(),
      username: z.string().nullable(),
      displayName: z.string(),
      status: UserStatusSchema,
      lastLoginAt: z.string().nullable(),
      preferences: z.object({ locale: z.string(), timezone: z.string() }),
    }),
    roles: z.array(RoleSummarySchema),
    permissions: z.array(PermissionKeySchema),
  }),
);

export const UpdateProfileSchema = defineSchema(
  'UpdateProfileRequest',
  z
    .object({
      displayName: z.string().trim().min(1).max(100).optional(),
      preferences: z
        .object({
          locale: z.string().max(10).optional(),
          timezone: z.string().max(64).optional(),
        })
        .optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'at least one field is required',
    }),
);

export const ChangePasswordSchema = defineSchema(
  'ChangePasswordRequest',
  z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: PasswordSchema,
  }),
);

export const ForgotPasswordSchema = defineSchema(
  'ForgotPasswordRequest',
  z.object({ email: z.string().trim().email().max(255) }),
);

export const ResetPasswordSchema = defineSchema(
  'ResetPasswordRequest',
  z.object({ token: z.string().min(10).max(200), newPassword: PasswordSchema }),
);

export const SetupSchema = defineSchema(
  'SetupRequest',
  z.object({ token: z.string().min(10).max(200), password: PasswordSchema }),
);

export const VerifySetupSchema = z.object({ token: z.string().min(10).max(200) });

export type LoginDto = z.infer<typeof LoginSchema>;
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
export type SetupDto = z.infer<typeof SetupSchema>;
export type ProfileDto = z.infer<typeof ProfileSchema>;
export type SessionDto = z.infer<typeof SessionSchema>;
