import { computed, ref } from "vue";

export interface ConfirmDialogOptions {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
}

interface ConfirmRequest {
  id: number;
  options: ConfirmDialogOptions;
  resolve: (value: boolean) => void;
}

const queue = ref<ConfirmRequest[]>([]);
let counter = 0;

const DEFAULT_OPTIONS: Required<ConfirmDialogOptions> = {
  title: "Konfirmasi",
  description: "",
  confirmText: "OK",
  cancelText: "Batal",
};

export const currentConfirm = computed(() => queue.value[0] ?? null);

export function enqueueConfirm(options: ConfirmDialogOptions): Promise<boolean> {
  const opts: ConfirmDialogOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  return new Promise<boolean>((resolve) => {
    queue.value = [
      ...queue.value,
      {
        id: ++counter,
        options: opts,
        resolve,
      },
    ];
  });
}

export function resolveCurrentConfirm(result: boolean) {
  const [current, ...rest] = queue.value;
  if (current) {
    current.resolve(result);
  }
  queue.value = rest;
}
