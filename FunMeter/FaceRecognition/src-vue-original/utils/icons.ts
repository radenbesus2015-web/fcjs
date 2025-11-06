import * as Lucide from "lucide-vue-next";

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
};

export function resolveLucideName(name?: string | null): string | null {
  if (!name) return null;
  if (tablerToLucide[name]) return tablerToLucide[name];
  if (name.startsWith("lucide:")) return name.slice(7);
  if (/^[A-Z][A-Za-z0-9]*$/.test(name)) return name; // direct component key
  return null;
}

export function getLucideComponent(name?: string | null) {
  const compName = resolveLucideName(name);
  if (!compName) return null;
  return (Lucide as any)[compName] ?? null;
}

export { Lucide };

