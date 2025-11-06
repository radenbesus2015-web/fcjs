<script setup lang="ts">
import { computed, ref, nextTick, onMounted } from "vue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { currentConfirm, resolveCurrentConfirm } from "@/stores/confirmStore";

const active = computed(() => currentConfirm.value);
const closingReason = ref<null | "confirm" | "cancel">(null);

function handleOpenChange(next: boolean) {
  if (!next && active.value) {
    nextTick(() => {
      resolveCurrentConfirm(closingReason.value === "confirm");
      closingReason.value = null;
    });
  }
}

function handleConfirm() {
  closingReason.value = "confirm";
}

function handleCancel() {
  closingReason.value = "cancel";
}
</script>

<template>
  <AlertDialog :open="!!active" @update:open="handleOpenChange">
    <AlertDialogContent v-if="active" :disableOutsidePointerEvents="false">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ active.options.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="active.options.description">
          {{ active.options.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="handleCancel">
          {{ active.options.cancelText }}
        </AlertDialogCancel>
        <AlertDialogAction @click="handleConfirm">
          {{ active.options.confirmText }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
