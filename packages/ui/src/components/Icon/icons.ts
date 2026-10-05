import ArrowDown from '../../icons/arrow-down.svg?react';
import ArrowUpDown from '../../icons/arrow-up-down.svg?react';
import ArrowUp from '../../icons/arrow-up.svg?react';
import Bell from '../../icons/bell.svg?react';
import Calendar from '../../icons/calendar.svg?react';
import Check from '../../icons/check.svg?react';
import ChevronDown from '../../icons/chevron-down.svg?react';
import ChevronLeft from '../../icons/chevron-left.svg?react';
import ChevronRight from '../../icons/chevron-right.svg?react';
import ChevronsDownUp from '../../icons/chevrons-down-up.svg?react';
import ChevronsUpDown from '../../icons/chevrons-up-down.svg?react';
import Close from '../../icons/close.svg?react';
import Copy from '../../icons/copy.svg?react';
import Download from '../../icons/download.svg?react';
import Edit from '../../icons/edit.svg?react';
import FileArchive from '../../icons/file-archive.svg?react';
import FileAudio from '../../icons/file-audio.svg?react';
import FileCode from '../../icons/file-code.svg?react';
import FileFont from '../../icons/file-font.svg?react';
import FileImage from '../../icons/file-image.svg?react';
import FilePdf from '../../icons/file-pdf.svg?react';
import FilePresentation from '../../icons/file-presentation.svg?react';
import FileSpreadsheet from '../../icons/file-spreadsheet.svg?react';
import FileText from '../../icons/file-text.svg?react';
import FileVideo from '../../icons/file-video.svg?react';
import File from '../../icons/file.svg?react';
import Filter from '../../icons/filter.svg?react';
import FolderMove from '../../icons/folder-move.svg?react';
import FolderPlus from '../../icons/folder-plus.svg?react';
import FolderUpload from '../../icons/folder-upload.svg?react';
import Folder from '../../icons/folder.svg?react';
import Globe from '../../icons/globe.svg?react';
import Grid from '../../icons/grid.svg?react';
import Home from '../../icons/home.svg?react';
import Info from '../../icons/info.svg?react';
import Key from '../../icons/key.svg?react';
import List from '../../icons/list.svg?react';
import Lock from '../../icons/lock.svg?react';
import Logout from '../../icons/logout.svg?react';
import Maximize from '../../icons/maximize.svg?react';
import Menu from '../../icons/menu.svg?react';
import Minus from '../../icons/minus.svg?react';
import Monitor from '../../icons/monitor.svg?react';
import Moon from '../../icons/moon.svg?react';
import More from '../../icons/more.svg?react';
import Network from '../../icons/network.svg?react';
import PinOff from '../../icons/pin-off.svg?react';
import Pin from '../../icons/pin.svg?react';
import Plus from '../../icons/plus.svg?react';
import Redo from '../../icons/redo.svg?react';
import Refresh from '../../icons/refresh.svg?react';
import Search from '../../icons/search.svg?react';
import Settings from '../../icons/settings.svg?react';
import Shield from '../../icons/shield.svg?react';
import Sun from '../../icons/sun.svg?react';
import Trash from '../../icons/trash.svg?react';
import Undo from '../../icons/undo.svg?react';
import Unlock from '../../icons/unlock.svg?react';
import Upload from '../../icons/upload.svg?react';
import User from '../../icons/user.svg?react';
import Users from '../../icons/users.svg?react';
import Warning from '../../icons/warning.svg?react';
import Wifi from '../../icons/wifi.svg?react';
import ZoomIn from '../../icons/zoom-in.svg?react';
import ZoomOut from '../../icons/zoom-out.svg?react';

/**
 * 圖示註冊表。元件裡 **不得** 內嵌 `<svg>` 字面量——換一套圖示時
 * 只要換 `src/icons/` 底下的檔案，呼叫端一行都不用改。
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
