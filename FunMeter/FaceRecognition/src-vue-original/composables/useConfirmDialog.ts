import { inject, provide } from "vue";
import type { ConfirmDialogOptions } from "@/stores/confirmStore";
import { enqueueConfirm } from "@/stores/confirmStore";

export type ConfirmDialogHandler = (options: ConfirmDialogOptions) => Promise<boolean>;

const CONFIRM_SYMBOL = Symbol("ConfirmDialog");

export function provideConfirmDialog(handler: ConfirmDialogHandler = enqueueConfirm) {
  provide(CONFIRM_SYMBOL, handler);
}

export function useConfirmDialog(): ConfirmDialogHandler {
  const handler = inject<ConfirmDialogHandler | null>(CONFIRM_SYMBOL, null);
  if (handler) return handler;

  return async (options: ConfirmDialogOptions = {}) => {
    const message = options.description || options.title || "";
    return window.confirm(message);
  };
}
