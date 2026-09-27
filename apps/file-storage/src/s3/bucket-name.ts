/**
 * General purpose bucket 的命名規則：
 * https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html
 */
export function isValidBucketName(name: string): boolean {
  if (name.length < 3 || name.length > 63) return false;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return false;
  if (name.includes('..') || name.includes('.-') || name.includes('-.')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return false;
  if (name.startsWith('xn--') || name.startsWith('sthree-')) return false;
  if (name.endsWith('-s3alias') || name.endsWith('--ol-s3')) return false;
  return true;
}
