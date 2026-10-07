import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { GRANT_LEVELS, GRANT_SUBJECT_TYPES } from '../file-grant.levels';

/** 授權對象的種類：角色或個別使用者（docs/architecture/iam/06-resource-grants.md §6.2）。 */
export const FILE_GRANT_SUBJECT_TYPES = GRANT_SUBJECT_TYPES;

export const GrantLevelSchema = z.enum(GRANT_LEVELS);
export const GrantSubjectTypeSchema = z.enum(FILE_GRANT_SUBJECT_TYPES);

export const SetFileFolderGrantSchema = defineSchema(
  'SetFileFolderGrantRequest',
  z.object({
    subjectType: GrantSubjectTypeSchema,
    subjectId: z.string().uuid(),
    level: GrantLevelSchema,
    /** 到這個時間之後不再計入（ISO 8601）；null 或不帶是不過期。必須在未來（§6.3）。 */
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .default(null)
      .refine((value) => value === null || Date.parse(value) > Date.now(), {
        message: 'must be in the future',
      }),
  }),
);

export const FileFolderGrantSchema = defineSchema(
  'FileFolderGrant',
  z.object({
    subjectType: GrantSubjectTypeSchema,
    subjectId: z.string().uuid(),
    subjectName: z.string(),
    level: GrantLevelSchema,
    /** null 是不過期。 */
    expiresAt: z.string().nullable(),
    /** 已過期：解析時不再計入，仍列出來讓管理者移除或延長。 */
    isExpired: z.boolean(),
    grantedAt: z.string(),
    /** 繼承自哪個上層資料夾；null 是這個資料夾的直接授權（只有直接授權能在這裡變更或移除）。 */
    source: z.object({ folderId: z.string().uuid(), folderName: z.string() }).nullable(),
  }),
);

export const FileFolderGrantListSchema = defineSchema(
  'FileFolderGrantList',
  z.object({
    folderId: z.string().uuid(),
    /** false = 中斷繼承（私人資料夾）：清單只有這個資料夾的直接授權。 */
    inheritGrants: z.boolean(),
    /** 操作者授予得起的等級（反提權，docs/architecture/iam/06-resource-grants.md §6.1）；後端仍會再檢查。 */
    assignableLevels: z.array(GrantLevelSchema),
    /** 直接授權在前，繼承的依上層由近而遠。 */
    items: z.array(FileFolderGrantSchema),
  }),
);

export const ListFileGrantSubjectsSchema = z.object({
  subjectType: GrantSubjectTypeSchema.default('role'),
  keyword: z.string().trim().max(100).optional(),
});

export const FileGrantSubjectListSchema = defineSchema(
  'FileGrantSubjectList',
  z.object({
    items: z.array(
      z.object({
        subjectType: GrantSubjectTypeSchema,
        id: z.string().uuid(),
        name: z.string(),
        /** 角色是 slug、使用者是帳號：同名時用來分辨。 */
        hint: z.string().nullable(),
      }),
    ),
  }),
);

export type SetFileFolderGrantDto = z.infer<typeof SetFileFolderGrantSchema>;
export type FileFolderGrantDto = z.infer<typeof FileFolderGrantSchema>;
export type FileFolderGrantListDto = z.infer<typeof FileFolderGrantListSchema>;
export type ListFileGrantSubjectsDto = z.infer<typeof ListFileGrantSubjectsSchema>;
export type FileGrantSubjectListDto = z.infer<typeof FileGrantSubjectListSchema>;
export type FileGrantSubjectType = z.infer<typeof GrantSubjectTypeSchema>;

export const UpdateFileFolderAccessSchema = defineSchema(
  'UpdateFileFolderAccessRequest',
  z.object({
    /** false = 中斷繼承；中斷時把目前繼承到的授權複製成直接授權（§3.3）。 */
    inheritGrants: z.boolean(),
  }),
);
export type UpdateFileFolderAccessDto = z.infer<typeof UpdateFileFolderAccessSchema>;
