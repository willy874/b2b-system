import ArrowDown from '@/assets/icons/arrow-down.svg?react';
import ArrowUpDown from '@/assets/icons/arrow-up-down.svg?react';
import ArrowUp from '@/assets/icons/arrow-up.svg?react';
import Bell from '@/assets/icons/bell.svg?react';
import Calendar from '@/assets/icons/calendar.svg?react';
import Check from '@/assets/icons/check.svg?react';
import ChevronDown from '@/assets/icons/chevron-down.svg?react';
import ChevronLeft from '@/assets/icons/chevron-left.svg?react';
import ChevronRight from '@/assets/icons/chevron-right.svg?react';
import ChevronsDownUp from '@/assets/icons/chevrons-down-up.svg?react';
import ChevronsUpDown from '@/assets/icons/chevrons-up-down.svg?react';
import Close from '@/assets/icons/close.svg?react';
import Copy from '@/assets/icons/copy.svg?react';
import Download from '@/assets/icons/download.svg?react';
import Edit from '@/assets/icons/edit.svg?react';
import FileArchive from '@/assets/icons/file-archive.svg?react';
import FileAudio from '@/assets/icons/file-audio.svg?react';
import FileCode from '@/assets/icons/file-code.svg?react';
import FileFont from '@/assets/icons/file-font.svg?react';
import FileImage from '@/assets/icons/file-image.svg?react';
import FilePdf from '@/assets/icons/file-pdf.svg?react';
import FilePresentation from '@/assets/icons/file-presentation.svg?react';
import FileSpreadsheet from '@/assets/icons/file-spreadsheet.svg?react';
import FileText from '@/assets/icons/file-text.svg?react';
import FileVideo from '@/assets/icons/file-video.svg?react';
import File from '@/assets/icons/file.svg?react';
import Filter from '@/assets/icons/filter.svg?react';
import FolderMove from '@/assets/icons/folder-move.svg?react';
import FolderPlus from '@/assets/icons/folder-plus.svg?react';
import FolderUpload from '@/assets/icons/folder-upload.svg?react';
import Folder from '@/assets/icons/folder.svg?react';
import Globe from '@/assets/icons/globe.svg?react';
import Grid from '@/assets/icons/grid.svg?react';
import Home from '@/assets/icons/home.svg?react';
import Info from '@/assets/icons/info.svg?react';
import Key from '@/assets/icons/key.svg?react';
import List from '@/assets/icons/list.svg?react';
import Lock from '@/assets/icons/lock.svg?react';
import Logout from '@/assets/icons/logout.svg?react';
import Maximize from '@/assets/icons/maximize.svg?react';
import Menu from '@/assets/icons/menu.svg?react';
import Minus from '@/assets/icons/minus.svg?react';
import Monitor from '@/assets/icons/monitor.svg?react';
import Moon from '@/assets/icons/moon.svg?react';
import More from '@/assets/icons/more.svg?react';
import Network from '@/assets/icons/network.svg?react';
import PinOff from '@/assets/icons/pin-off.svg?react';
import Pin from '@/assets/icons/pin.svg?react';
import Plus from '@/assets/icons/plus.svg?react';
import Redo from '@/assets/icons/redo.svg?react';
import Refresh from '@/assets/icons/refresh.svg?react';
import Search from '@/assets/icons/search.svg?react';
import Settings from '@/assets/icons/settings.svg?react';
import Shield from '@/assets/icons/shield.svg?react';
import Sun from '@/assets/icons/sun.svg?react';
import Trash from '@/assets/icons/trash.svg?react';
import Undo from '@/assets/icons/undo.svg?react';
import Unlock from '@/assets/icons/unlock.svg?react';
import Upload from '@/assets/icons/upload.svg?react';
import User from '@/assets/icons/user.svg?react';
import Users from '@/assets/icons/users.svg?react';
import Warning from '@/assets/icons/warning.svg?react';
import Wifi from '@/assets/icons/wifi.svg?react';
import ZoomIn from '@/assets/icons/zoom-in.svg?react';
import ZoomOut from '@/assets/icons/zoom-out.svg?react';

/**
 * 圖示註冊表。元件裡 **不得** 內嵌 `<svg>` 字面量——換一套圖示時
 * 只要換 `src/assets/icons/` 底下的檔案，呼叫端一行都不用改。
 */
export const ICONS = {
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'arrow-up-down': ArrowUpDown,
  bell: Bell,
  calendar: Calendar,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevrons-down-up': ChevronsDownUp,
  'chevrons-up-down': ChevronsUpDown,
  close: Close,
  copy: Copy,
  download: Download,
  edit: Edit,
  file: File,
  'file-archive': FileArchive,
  'file-audio': FileAudio,
  'file-code': FileCode,
  'file-font': FileFont,
  'file-image': FileImage,
  'file-pdf': FilePdf,
  'file-presentation': FilePresentation,
  'file-spreadsheet': FileSpreadsheet,
  'file-text': FileText,
  'file-video': FileVideo,
  filter: Filter,
  folder: Folder,
  'folder-move': FolderMove,
  'folder-plus': FolderPlus,
  'folder-upload': FolderUpload,
  globe: Globe,
  grid: Grid,
  home: Home,
  info: Info,
  key: Key,
  list: List,
  lock: Lock,
  logout: Logout,
  maximize: Maximize,
  menu: Menu,
  minus: Minus,
  monitor: Monitor,
  moon: Moon,
  more: More,
  network: Network,
  pin: Pin,
  'pin-off': PinOff,
  plus: Plus,
  redo: Redo,
  refresh: Refresh,
  search: Search,
  settings: Settings,
  shield: Shield,
  sun: Sun,
  trash: Trash,
  undo: Undo,
  unlock: Unlock,
  upload: Upload,
  user: User,
  users: Users,
  warning: Warning,
  wifi: Wifi,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
} as const;

export type IconName = keyof typeof ICONS;
