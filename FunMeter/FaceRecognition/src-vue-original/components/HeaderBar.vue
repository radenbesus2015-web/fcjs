<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";
import Icon from "@/components/Icon.vue";

const props = defineProps({
  hidden: { type: Boolean, default: false },
  left: { type: Number, default: 0 },
  transStyle: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["height"]);
const { t } = useI18n();

const route = useRoute();

const headerEl = ref<HTMLElement | null>(null);
function measure() {
  const h = headerEl.value?.getBoundingClientRect()?.height;
  if (h) emit("height", Math.round(h));
}
onMounted(measure);
watch(() => props.left, measure);

const headerClass = computed(() => (props.hidden ? "-translate-y-full opacity-0" : "translate-y-0 opacity-100"));

const crumb = computed(() => {
  if (route.path.startsWith("/admin")) return t("header.breadcrumb.admin", "Admin");
  return t("header.breadcrumb.website", "Situs");
});

const title = computed(() => {
  const m: any = route.meta || {};
  const key = m.titleKey || m.navKey;
  const fb = m.titleFallback || m.navFallback || route.name || t("header.title.default", "Pengenalan Wajah");
  return t(key, fb) ?? String(fb);
});
</script>

<template>
  <div
    ref="headerEl"
    class="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-all"
    :class="headerClass"
    :style="[{ left: props.left + 'px', right: '0px' }, props.transStyle]">
    <div class="flex h-14 items-center gap-2 px-3 sm:h-16 sm:px-4">
      <!-- Mobile trigger langsung ke SidebarProvider -->
      <SidebarTrigger
        class="inline-flex lg:hidden"
        :aria-label="t('header.actions.openNavigation', 'Buka navigasi')" />

      <!-- Desktop trigger / custom slot kiri -->
      <div class="hidden items-center lg:flex">
        <slot name="left">
          <SidebarTrigger />
        </slot>
      </div>

      <!-- Breadcrumb + Title -->
      <div class="min-w-0">
        <p class="text-[11px] uppercase tracking-widest text-muted-foreground">
          {{ crumb }}
        </p>
        <h1 class="truncate text-base font-semibold sm:text-lg">
          {{ title }}
        </h1>
      </div>

      <!-- Actions -->
      <div class="ml-auto flex items-center gap-2">
        <RouterLink
          to="/absensi-fun-meter"
          class="hidden sm:inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground">
          <Icon name="Radio" class="h-4 w-4" />
          <span>{{ t("header.actions.live", "Langsung") }}</span>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
