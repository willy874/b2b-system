import Calendar from '@/assets/icons/calendar.svg?react';
import Check from '@/assets/icons/check.svg?react';
import ChevronDown from '@/assets/icons/chevron-down.svg?react';
import ChevronLeft from '@/assets/icons/chevron-left.svg?react';
import ChevronRight from '@/assets/icons/chevron-right.svg?react';
import Close from '@/assets/icons/close.svg?react';
import Edit from '@/assets/icons/edit.svg?react';
import File from '@/assets/icons/file.svg?react';
import Filter from '@/assets/icons/filter.svg?react';
import Home from '@/assets/icons/home.svg?react';
import Info from '@/assets/icons/info.svg?react';
import Key from '@/assets/icons/key.svg?react';
import List from '@/assets/icons/list.svg?react';
import Logout from '@/assets/icons/logout.svg?react';
import Menu from '@/assets/icons/menu.svg?react';
import Minus from '@/assets/icons/minus.svg?react';
import Plus from '@/assets/icons/plus.svg?react';
import Search from '@/assets/icons/search.svg?react';
import Settings from '@/assets/icons/settings.svg?react';
import Shield from '@/assets/icons/shield.svg?react';
import Trash from '@/assets/icons/trash.svg?react';
import Upload from '@/assets/icons/upload.svg?react';
import User from '@/assets/icons/user.svg?react';
import Users from '@/assets/icons/users.svg?react';
import Warning from '@/assets/icons/warning.svg?react';

/**
 * 圖示註冊表。元件裡 **不得** 內嵌 `<svg>` 字面量——換一套圖示時
 * 只要換 `src/assets/icons/` 底下的檔案，呼叫端一行都不用改。
 */
export const ICONS = {
  calendar: Calendar,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  close: Close,
  edit: Edit,
  file: File,
  filter: Filter,
  home: Home,
  info: Info,
  key: Key,
  list: List,
  logout: Logout,
  menu: Menu,
  minus: Minus,
  plus: Plus,
  search: Search,
  settings: Settings,
  shield: Shield,
  trash: Trash,
  upload: Upload,
  user: User,
  users: Users,
  warning: Warning,
} as const;

export type IconName = keyof typeof ICONS;
