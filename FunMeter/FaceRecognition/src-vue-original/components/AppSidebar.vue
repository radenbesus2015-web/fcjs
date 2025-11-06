<script setup lang="ts">
import type { SidebarProps } from "@/components/ui/sidebar";
import type { Component } from "vue";
import { computed, h, inject } from "vue";
import { useI18n } from "@/i18n";
import Icon from "@/components/Icon.vue";

import RouterMenuButton from "@/components/RouterMenuButton.vue";
import { isExternalLink } from "@/utils/link";

// Props...
const props = withDefaults(
  defineProps<
    SidebarProps & {
      navItems?: Array<{
        name?: string;
        to: string;
        icon?: string | Component;
        labelKey?: string;
        labelFallback?: string;
      }>;
    }
  >(),
  { side: "left", variant: "sidebar", collapsible: "icon" }
);

const { t } = useI18n();
const ft = (path:any, fallback:any, values:any) => t(`aside.${path}`, fallback, values);
const settings = inject<any>("settings", null);
const auth = inject<any>("auth", null);

const isAdmin = (it: any) => String(it?.to || "").startsWith("/admin");
const baseNav = computed(() => (props.navItems || []).filter((it) => !isAdmin(it)));
const adminNav = computed(() => (props.navItems || []).filter(isAdmin));

function RenderIcon({ icon }: { icon?: string | Component }) {
  if (!icon) return null as any;
  if (typeof icon === "string") {
    return h(Icon, { name: icon, class: "h-6 w-6" });
  }
  return h(icon as Component, { class: "h-6 w-6" });
}

const displayName = computed(() => {
  const u = auth?.state?.user;
  return String(u?.username || u?.name || "").trim();
});

function getInitials(raw?: string) {
  const name = String(raw || "")
    .replace(/_/g, " ") // underscore -> spasi
    .replace(/\s+/g, " ") // rapihin spasi ganda
    .trim();

  if (!name) return "??";

  const parts = name.split(" ").filter(Boolean);
  const first = (s: string) => s.charAt(0)?.toUpperCase() || "";

  // kalau ada >= 2 kata, ambil 2 huruf awal dari dua kata pertama
  if (parts.length >= 2) return first(parts[0]) + first(parts[1]);

  // kalau 1 kata, ambil 1 huruf awal
  return first(parts[0]);
}

const initials = computed(() => getInitials(displayName.value));
</script>

<template>
  <Sidebar v-bind="props">
    <SidebarRail />

    <SidebarHeader>
      <SidebarMenuButton
        size="lg"
        class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
        <Avatar class="place-items-center rounded-lg">
          <AvatarFallback class="ti ti-mood-check bg-primary text-primary-foreground text-xl" />
        </Avatar>

        <div class="grid flex-1 text-left text-sm leading-tight">
          <span class="truncate font-semibold">{{ ft("brand.title", "Absensi Wajah") }}</span>
        </div>
      </SidebarMenuButton>
    </SidebarHeader>
    <SidebarContent>
      <!-- MAIN -->
      <SidebarGroup v-if="baseNav.length">
        <SidebarGroupLabel>{{ ft("groups.main", "Menu Utama") }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in baseNav" :key="item.to">
              <template v-if="!isExternalLink(item.to)">
                <RouterMenuButton
                  :to="item.to"
                  :tooltip="t(item.labelKey || '', item.labelFallback || String(item.name || ''))">
                  <RenderIcon :icon="item.icon" />
                  <span class="truncate">
                    {{ t(item.labelKey || "", item.labelFallback || String(item.name || "")) }}
                  </span>
                </RouterMenuButton>
              </template>
              <template v-else>
                <SidebarMenuButton
                  as-child
                  :tooltip="t(item.labelKey || '', item.labelFallback || String(item.name || ''))">
                  <a :href="item.to" target="_blank" rel="noopener noreferrer">
                    <RenderIcon :icon="item.icon" />
                    <span class="truncate">
                      {{ t(item.labelKey || "", item.labelFallback || String(item.name || "")) }}
                    </span>
                  </a>
                </SidebarMenuButton>
              </template>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <!-- ADMIN -->
      <SidebarGroup v-if="adminNav.length">
        <SidebarGroupLabel>{{ ft("groups.admin", "Admin") }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in adminNav" :key="item.to">
              <RouterMenuButton
                :to="item.to"
                :tooltip="t(item.labelKey || '', item.labelFallback || String(item.name || ''))">
                <RenderIcon :icon="item.icon" />
                <span class="truncate">
                  {{ t(item.labelKey || "", item.labelFallback || String(item.name || "")) }}
                </span>
              </RouterMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            as-child
            @click="settings?.openModal?.()"
            :tooltip="ft('actions.openSettings', 'Buka Pengaturan')">
            <button type="button">
              <Icon name="Settings" class="h-6 w-6" />
              <span class="truncate">{{ ft("actions.openSettings", "Buka Pengaturan") }}</span>
            </button>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <template v-if="auth?.state?.user">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <SidebarMenuButton
              size="lg"
              class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <Avatar class="place-items-center rounded-lg">
                <AvatarFallback class="bg-primary text-primary-foreground text-sm">{{ initials }}</AvatarFallback>
              </Avatar>

              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-semibold">
                  {{ auth?.state?.user?.username || auth?.state?.user?.name }}
                </span>
              </div>
              <Icon name="ChevronsUpDown" class="size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            class="w-[var(--reka-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
            align="start"
            :side-offset="4">
            <DropdownMenuLabel>
              <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar class="place-items-center rounded-lg">
                  <AvatarFallback class="bg-primary text-primary-foreground text-sm">{{ initials }}</AvatarFallback>
                </Avatar>

                <div class="grid flex-1 text-left text-sm leading-tight">
                  <span class="truncate font-semibold">
                    {{ auth?.state?.user?.username || auth?.state?.user?.name }}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="gap-2 p-2" @click="auth?.logout?.()">
              <Icon name="LogOut" class="size-4" />
              <div class="font-medium">{{ t("auth.menu.logout", "Keluar") }}</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
      <template v-else>
        <SidebarMenuItem class="mt-2">
          <SidebarMenuButton
            size="xs"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            @click="auth?.openModal?.('login')">
            <Icon name="LogIn" class="h-4 w-4" />
            <span class="truncate font-semibold">{{ t("auth.actions.login", "Masuk") }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </template>
    </SidebarFooter>
  </Sidebar>
</template>
