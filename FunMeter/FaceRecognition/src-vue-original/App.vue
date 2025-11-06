<script setup>
import AppShell from "./layout/AppShell.vue";
import { Toaster } from "vue-sonner";
import { computed } from "vue";
import { useDark } from "@vueuse/core";
import GlobalConfirm from "@/components/GlobalConfirm.vue";
import { provideConfirmDialog } from "@/composables/useConfirmDialog";

provideConfirmDialog();
const isDark = useDark({
  selector: "html",
  attribute: "class",
  valueDark: "dark",
  valueLight: "light",
  storageKey: "app-theme",
});
const toasterTheme = computed(() => (isDark.value ? "dark" : "light"));
</script>

<template>
  <Toaster
    :theme="toasterTheme"
    :visibleToasts="2"
    richColors
    position="bottom-right"
    swipeDirections="top,bottom,left,right"
    closeButton
    closeButtonPosition="top-right"
    :expand="true" />

  <AppShell />
  <GlobalConfirm />

</template>
