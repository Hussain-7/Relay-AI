import {
  ArrowUp,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Info,
  Key,
  MoreHorizontal,
  PanelLeft,
  Paperclip,
  Pause,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

const ICON_SIZE = 16;
const ICON_CLASS = "h-4 w-4";

export function IconClose() {
  return <X size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconSidebarToggle() {
  return <PanelLeft size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconPlus() {
  return <Plus size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconSearch() {
  return <Search size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconArrowUp() {
  return <ArrowUp size={ICON_SIZE} className={ICON_CLASS} />;
}

// App trademark icon — keep as custom SVG
export function IconSpark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON_CLASS}>
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" />
    </svg>
  );
}

export function IconChevron() {
  return <ChevronDown size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconMore() {
  return <MoreHorizontal size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconCheck() {
  return <Check size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconTool() {
  return <Wrench size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconThinking() {
  return <Clock size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconDone() {
  return <CheckCircle size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconInfo() {
  return <Info size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconPaperclip() {
  return <Paperclip size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconConnector() {
  return <Plug size={ICON_SIZE} className={ICON_CLASS} />;
}

// GitHub logo — keep as custom SVG (brand-specific path)
export function IconGithub() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={ICON_CLASS} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function IconRefresh({ spinning }: { spinning?: boolean } = {}) {
  return <RefreshCw size={ICON_SIZE} className={`${ICON_CLASS}${spinning ? " animate-spin" : ""}`} />;
}

export function IconKey() {
  return <Key size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconCopy() {
  return <Copy size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconClock() {
  return <Clock size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconCalendar() {
  return <Calendar size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconPause() {
  return <Pause size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconPlay() {
  return <Play size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconTrash() {
  return <Trash2 size={ICON_SIZE} className={ICON_CLASS} />;
}

export function IconExternalLink() {
  return <ExternalLink size={ICON_SIZE} className={ICON_CLASS} />;
}
