// lib/icons.ts
// Port dari src-vue-original/utils/icons.ts untuk React

import * as Lucide from "lucide-react";

const tablerToLucide: Record<string, string> = {
  // Router/nav
  "ti-home": "Home",
  "ti-id-badge-2": "IdCard",
  "ti-mood-smile-beam": "Smile",
  "ti-device-camera-phone": "Camera",
  "ti-user-plus": "UserPlus",
  "ti-layout-dashboard": "LayoutDashboard",
  "ti-clipboard-list": "ClipboardList",
  "ti-clock": "Clock",
  "ti-users-group": "Users",
  "ti-adjustments-horizontal": "Settings",
  "ti-database-plus": "Database",
  "ti-chart-bar": "BarChart3",
  "ti-settings-2": "Settings2",

  // UI controls/common
  "ti-menu-2": "Menu",
  "ti-settings": "Settings",
  "ti-x": "X",
  "ti-sun-high": "Sun",
  "ti-moon-stars": "Moon",
  "ti-arrow-right": "ChevronRight",
  "ti-arrow-up-right": "ExternalLink",
  "ti-login-2": "LogIn",
  "ti-logout-2": "LogOut",
  "ti-user": "User",

  // Status/icons in pages
  "ti-circle-check": "CheckCircle",
  "ti-alert-triangle": "AlertTriangle",
  "ti-circle-x": "XCircle",
  "ti-loader-2": "Loader2",
  "ti-corner-up-right-double": "CornerUpRight",
  "ti-chevrons-left": "ChevronsLeft",
  "ti-chevron-left": "ChevronLeft",
  "ti-chevron-right": "ChevronRight",
  "ti-chevrons-right": "ChevronsRight",
  "ti-rotate-2": "RotateCcw",
  "ti-rocket": "Rocket",
  "ti-refresh": "RefreshCw",
  "ti-code": "Code",
  "ti-eye": "Eye",
  "ti-eye-off": "EyeOff",
  "ti-copy": "Copy",
  "ti-refresh-cw": "RefreshCw",
  "ti-trash": "Trash2",
  "ti-pencil": "Pencil",
  "ti-plus": "Plus",
  "ti-calendar": "CalendarRange",
  "ti-megaphone": "Megaphone",

  // Direct mappings untuk nama yang sudah benar
  "Home": "Home",
  "Eye": "Eye",
  "EyeOff": "EyeOff",
  "Copy": "Copy",
  "RefreshCw": "RefreshCw",
  "Loader2": "Loader2",
  "Trash2": "Trash2",
  "Pencil": "Pencil",
  "Plus": "Plus",
  "CalendarRange": "CalendarRange",
  "Megaphone": "Megaphone",
  "IdCard": "IdCard", 
  "Smile": "Smile",
  "Camera": "Camera",
  "UserPlus": "UserPlus",
  "LayoutDashboard": "LayoutDashboard",
  "Database": "Database",
  "Clock": "Clock",
  "ClipboardList": "ClipboardList",
  "BarChart3": "BarChart3",
  "Users": "Users",
  "Settings2": "Settings2",
};

export function resolveLucideName(name?: string | null): string | null {
  if (!name) return null;
  if (tablerToLucide[name]) return tablerToLucide[name];
  if (name.startsWith("lucide:")) return name.slice(7);
  if (/^[A-Z][A-Za-z0-9]*$/.test(name)) return name; // direct component key
  return null;
}

export function getLucideComponent(name?: string | null): React.ComponentType<Lucide.LucideProps> | null {
  const compName = resolveLucideName(name);
  if (!compName) return null;
  const lucideComponents = Lucide as unknown as Record<string, React.ComponentType<Lucide.LucideProps>>;
  return lucideComponents[compName] ?? null;
}

export { Lucide };
