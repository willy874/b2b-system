import { uploadFile } from './fetcher';
import type { UploadFileParams } from './fetcher';

export const getFileUploadMutationOptions = () => ({
  mutationFn: (params: UploadFileParams) => uploadFile(params),
});
