import { z } from 'zod';

import { ImageSourcesSchema } from '@/core/image';
import { defineSchema } from '@/core/validation';

import { GALLERY_ALBUM_ITEMS_MAX } from '../gallery.constants';

const NameSchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(1000);

export const GalleryAlbumSchema = defineSchema(
  'GalleryAlbum',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    /** 相簿裡（未刪除、處理完成）的張數。 */
    itemCount: z.number().int(),
    /** 指定的封面；null 時 `cover` 是最新的一張。 */
    coverItemId: z.string().uuid().nullable(),
    /** 封面的各尺寸（同 `GalleryItem.image`）；空的相簿是 null。 */
    cover: ImageSourcesSchema.nullable(),
    /** 封面的主色（載入前的背景，D11）。 */
    coverColor: z.string().nullable(),
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const GalleryAlbumListSchema = defineSchema(
  'GalleryAlbumList',
  z.object({ items: z.array(GalleryAlbumSchema) }),
);

export const CreateGalleryAlbumSchema = defineSchema(
  'CreateGalleryAlbumRequest',
  z.object({ name: NameSchema, description: DescriptionSchema.nullable().optional() }),
);

export const UpdateGalleryAlbumSchema = defineSchema(
  'UpdateGalleryAlbumRequest',
  z
    .object({
      version: z.number().int().positive(),
      name: NameSchema.optional(),
      description: DescriptionSchema.nullable().optional(),
      /** null：改回「最新的一張」。 */
      coverItemId: z.string().uuid().nullable().optional(),
    })
    .refine(
      (dto) =>
        dto.name !== undefined || dto.description !== undefined || dto.coverItemId !== undefined,
      { message: 'nothing to update' },
    ),
);

export const GalleryAlbumItemsSchema = defineSchema(
  'GalleryAlbumItemsRequest',
  z.object({ itemIds: z.array(z.string().uuid()).min(1).max(GALLERY_ALBUM_ITEMS_MAX) }),
);

export const GalleryAlbumItemsResultSchema = defineSchema(
  'GalleryAlbumItemsResult',
  z.object({
    /** 實際加入（或移出）的張數；已經在（或本來就不在）相簿裡的不算。 */
    changed: z.number().int(),
  }),
);

export type GalleryAlbumDto = z.infer<typeof GalleryAlbumSchema>;
export type CreateGalleryAlbumDto = z.infer<typeof CreateGalleryAlbumSchema>;
export type UpdateGalleryAlbumDto = z.infer<typeof UpdateGalleryAlbumSchema>;
export type GalleryAlbumItemsDto = z.infer<typeof GalleryAlbumItemsSchema>;
