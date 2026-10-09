import { describe, expect, it } from 'vitest';

import {
  buildGalleryPlan,
  GALLERY_ALBUMS,
  GALLERY_COMMENTS,
  GALLERY_ITEM_COUNT,
  GALLERY_TAGS,
} from '../gallery';

/** 圖片庫的假資料要讓日期捲軸、直式／橫式、位置移除、相簿、回收桶都看得到效果（docs/architecture/backend/26-gallery.md）。 */
describe('dev seed 的圖片庫規劃', () => {
  const plans = buildGalleryPlan();

  it('同一個亂數種子每次得到同一份規劃（重跑 seed 的圖片內容相同）', () => {
    expect(buildGalleryPlan()).toEqual(plans);
  });

  it('數十張，key 不重複', () => {
    expect(plans).toHaveLength(GALLERY_ITEM_COUNT);
    expect(new Set(plans.map((plan) => plan.key)).size).toBe(plans.length);
  });

  it('直式與橫式都有', () => {
    const portrait = plans.filter((plan) => plan.photo.height > plan.photo.width);
    const landscape = plans.filter((plan) => plan.photo.width > plan.photo.height);
    expect(portrait.length).toBeGreaterThan(3);
    expect(landscape.length).toBeGreaterThan(3);
  });

  it('拍攝時間涵蓋至少 12 個不同的月份', () => {
    const months = new Set(
      plans.flatMap((plan) =>
        plan.photo.exif ? [plan.photo.exif.dateTimeOriginal.slice(0, 7)] : [],
      ),
    );
    expect(months.size).toBeGreaterThanOrEqual(12);
  });

  it('有帶相機與 GPS 的、也有完全沒有 EXIF 的', () => {
    expect(plans.some((plan) => plan.photo.exif?.camera)).toBe(true);
    expect(plans.filter((plan) => plan.photo.exif?.location).length).toBeGreaterThan(5);
    expect(plans.some((plan) => !plan.photo.exif)).toBe(true);
  });

  it('EXIF 的拍攝時間是 YYYY:MM:DD HH:MM:SS', () => {
    for (const plan of plans) {
      if (plan.photo.exif) {
        expect(plan.photo.exif.dateTimeOriginal).toMatch(/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/);
      }
    }
  });

  it('沒有 EXIF 的圖以加入時間排序：加入時間不會晚於拍攝的錨點', () => {
    const latest = Math.max(...plans.map((plan) => plan.createdAt.getTime()));
    expect(latest).toBeLessThanOrEqual(Date.UTC(2026, 8, 28));
  });

  it('兩張在回收桶', () => {
    expect(plans.filter((plan) => plan.deletedDaysAgo !== null)).toHaveLength(2);
  });

  it('有一張與另一張內容相同（重複的提示，D7）', () => {
    const specs = plans.map((plan) => JSON.stringify(plan.photo));
    expect(new Set(specs).size).toBe(plans.length - 1);
  });

  it('相簿、封面、標籤、留言引用的都存在；封面在它的相簿裡', () => {
    const albumKeys = new Set(GALLERY_ALBUMS.map((album) => album.key));
    const tagKeys = new Set(GALLERY_TAGS.map((tag) => tag.key));
    const byKey = new Map(plans.map((plan) => [plan.key, plan]));
    for (const plan of plans) {
      for (const album of plan.albums) expect(albumKeys).toContain(album);
      for (const tag of plan.tags) expect(tagKeys).toContain(tag);
    }
    for (const album of GALLERY_ALBUMS) {
      if (album.cover) expect(byKey.get(album.cover)?.albums).toContain(album.key);
    }
    for (const comment of GALLERY_COMMENTS) {
      expect(byKey.has(comment.item)).toBe(true);
      expect(comment.author).toBeGreaterThanOrEqual(1);
      expect(comment.author).toBeLessThanOrEqual(35);
    }
  });

  it('至少一張圖同時在兩個相簿', () => {
    expect(plans.some((plan) => plan.albums.length >= 2)).toBe(true);
  });

  it('相簿名稱不分大小寫不重複（gallery_albums_name_key）', () => {
    const names = GALLERY_ALBUMS.map((album) => album.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
