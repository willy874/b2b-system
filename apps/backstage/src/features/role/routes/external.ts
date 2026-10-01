/** 跨 feature 只引用 route 物件（等同引用一個字串路徑），集中在這一個檔案。 */
export { UserDetailRoute, UserListRoute } from '@/features/user/routes';
// 直接指向 `routes/pages`：group 的 external 也引用 role 的 routes，經由 index 會形成循環
export { GroupDetailRoute } from '@/features/group/routes/pages';
