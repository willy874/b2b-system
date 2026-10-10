/**
 * 上傳的共用程式（docs/architecture/frontend/12-file-manager.md §8）：展開拖放／選取的資料夾、
 * 每個 feature 自己的暫存區（IndexedDB，跨分頁接手）、圖片的檔頭簽章。原本在 `features/file`，
 * 抽到這裡讓其他會上傳的 feature 共用（feature 之間不能互相 import）。
 *
 * 直傳物件儲存（單次 PUT）用 `@b2b-system/web-core/direct-upload` 的 `putToStorage`，不在這裡；
 * 分塊上傳只有檔案管理需要，留在 `apis/file/upload-file/`。
 */
export * from './collectEntries';
export * from './imageSignature';
export * from './uploadSources';
export * from './pairedItemId';
export * from './uploadRunner';
