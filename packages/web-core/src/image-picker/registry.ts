import { useStore } from '@b2b-system/web-shared/hooks';
import { createRegistry } from '@b2b-system/web-shared/registry';
import { useMemo } from 'react';

import type { ImagePickerApi, ImageSourceDefinition } from './types';

/** 內建的來源「上傳」：永遠可用、永遠是第一個，不在註冊表裡（feature 拿不掉它）。 */
export const UPLOAD_IMAGE_SOURCE = 'upload';

export const imageSourceRegistry = createRegistry<string, ImageSourceDefinition>('Image source');

/** 在 plugin 的同步階段登記；重複登記丟例外。回傳反註冊函式。 */
export function registerImageSource(source: ImageSourceDefinition): () => void {
  if (source.id === UPLOAD_IMAGE_SOURCE) throw new Error('「上傳」是內建的來源，不能登記');
  return imageSourceRegistry.register(source.id, source);
}

/** 依 `order` 排好的來源（不含「上傳」）。 */
export function useImageSources(): ImageSourceDefinition[] {
  const entries = useStore(imageSourceRegistry.store, (state) => state.entries);
  // 註冊表沒變時回傳同一個陣列：依賴它的 callback 才不會每次 render 都換新
  return useMemo(() => [...entries.values()].toSorted((a, b) => a.order - b.order), [entries]);
}

const apiRegistry = createRegistry<'default', ImagePickerApi>('Image picker api');

/** app 啟動時注入選圖要打的 api（web-core 不呼叫 app 的 API）。 */
export function registerImagePickerApi(api: ImagePickerApi): () => void {
  return apiRegistry.register('default', api);
}

/** 沒有登記時是 undefined：欄位顯示成停用，而不是讓整頁壞掉（例：沒有登記的 app、只測其他區塊的頁面測試）。 */
export function useImagePickerApi(): ImagePickerApi | undefined {
  return useStore(apiRegistry.store, (state) => state.entries.get('default'));
}

/** 測試用。 */
export function resetImagePickerRegistry(): void {
  imageSourceRegistry.reset();
  apiRegistry.reset();
}
