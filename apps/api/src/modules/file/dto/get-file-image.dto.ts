import { z } from 'zod';

import { IMAGE_FORMATS } from '@/core/image';
import { defineSchema } from '@/core/validation';

import { IMAGE_VARIANTS } from '../file.constants';

export const ImageVariantSchema = z.enum(IMAGE_VARIANTS);

/**
 * 影像 API 的 query。`exp` / `sig` 由 `StoredFile.image` 的網址帶上，前端不自己組；
 * 前端只可能在網址後面加 `format`。
 */
export const GetFileImageSchema = defineSchema(
  'GetFileImageQuery',
  z.object({
    /** 網址的失效時間（Unix 秒）。 */
    exp: z.coerce.number().int().positive(),
    sig: z.string().trim().min(1).max(100),
    /**
     * 不指定：主格式（圖示／全螢幕預覽是 progressive JPEG，有透明度的圖是 WebP；原圖原封不動）。
     * `jpeg`（一律 progressive）/ `webp` / `avif` / `png`：轉成指定格式；
     * `auto`：依 `Accept` 標頭挑 AVIF → WebP，都不支援時同不指定。
     */
    format: z.enum([...IMAGE_FORMATS, 'auto']).optional(),
  }),
);

export type GetFileImageDto = z.infer<typeof GetFileImageSchema>;
