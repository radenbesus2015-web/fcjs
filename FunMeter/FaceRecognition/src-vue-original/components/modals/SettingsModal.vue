<script setup>
import { computed, inject } from "vue";
import { useI18n } from "@/i18n";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const settings = inject("settings");
const { t } = useI18n();
const ft = (path, fallback) => t(`settings.${path}`, fallback);

const languageOptions = computed(() => settings?.languageOptions ?? []);
</script>

<template>
  <Dialog
    :open="settings?.modalOpen?.value"
    @update:open="
      (v) => {
        if (!v) settings?.closeModal();
      }
    ">
    <DialogContent
      class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg duration-200 focus:outline-none">
      <div class="flex items-center justify-between gap-4 border-b pb-4">
        <div>
          <p class="text-xs text-muted-foreground uppercase tracking-widest">
            {{ ft("breadcrumb", "Preferensi") }}
          </p>
          <DialogTitle as="h2" class="text-xl font-semibold">{{
            ft("title", "Pengaturan Tampilan & Kualitas")
          }}</DialogTitle>
        </div>
      </div>

      <form class="space-y-6" @submit.prevent="settings?.submit()">
        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-muted-foreground">{{ ft("language.title", "Bahasa") }}</h3>
          <label class="space-y-2 block">
            <select
              v-model="settings.form.language"
              class="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm">
              <option v-for="option in languageOptions" :key="option.code" :value="option.code">
                {{ ft(`language.options.${option.code}`, option.label ?? option.code.toUpperCase()) }}
              </option>
            </select>
            <p class="text-xs text-muted-foreground">
              {{ ft("language.help", "Mengatur bahasa antarmuka. Default: Bahasa Indonesia.") }}
            </p>
          </label>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-muted-foreground">{{ ft("theme.title", "Tema") }}</h3>
          <div class="grid gap-3 grid-cols-2">
            <label
              class="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium cursor-pointer"
              :class="settings.form.theme === 'light' ? 'bg-accent text-accent-foreground' : ''">
              <input v-model="settings.form.theme" class="sr-only" type="radio" value="light" />
              <i class="ti ti-sun-high text-base"></i>
              <span>{{ ft("theme.light", "Terang") }}</span>
            </label>
            <label
              class="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium cursor-pointer"
              :class="settings.form.theme === 'dark' ? 'bg-accent text-accent-foreground' : ''">
              <input v-model="settings.form.theme" class="sr-only" type="radio" value="dark" />
              <i class="ti ti-moon-stars text-base"></i>
              <span>{{ ft("theme.dark", "Gelap") }}</span>
            </label>
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-muted-foreground">
            {{ ft("attendance.title", "Streaming Absensi") }}
          </h3>
          <div class="grid gap-4 grid-cols-2">
            <label class="space-y-2">
              <Label class="text-sm font-medium">{{ ft("attendance.width.label", "Lebar Kirim (px)") }}</Label>
              <Input
                v-model.number="settings.form.attendanceSendWidth"
                type="number"
                min="120"
                max="1920"
                class="h-9" />
              <p class="text-xs text-muted-foreground">
                {{ ft("attendance.width.help", "Mengatur resolusi frame untuk absensi.") }}
              </p>
            </label>
            <label class="space-y-2">
              <Label class="text-sm font-medium">{{ ft("attendance.jpeg.label", "Kualitas JPEG") }}</Label>
              <Input
                v-model.number="settings.form.attendanceJpegQuality"
                type="number"
                step="0.05"
                min="0.1"
                max="1"
                class="h-9" />
              <p class="text-xs text-muted-foreground">
                {{
                  ft(
                    "attendance.jpeg.help",
                    "Antara 0.1 - 1.0. Nilai tinggi lebih tajam namun ukuran data lebih besar."
                  )
                }}
              </p>
            </label>
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-muted-foreground">
            {{ ft("funMeter.title", "Streaming Fun Meter") }}
          </h3>
          <div class="grid gap-4 grid-cols-2">
            <label class="space-y-2">
              <Label class="text-sm font-medium">{{ ft("funMeter.width.label", "Lebar Kirim (px)") }}</Label>
              <Input v-model.number="settings.form.funSendWidth" type="number" min="160" max="1920" class="h-9" />
              <p class="text-xs text-muted-foreground">
                {{ ft("funMeter.width.help", "Mengatur resolusi frame untuk analisis emosi.") }}
              </p>
            </label>
            <label class="space-y-2">
              <Label class="text-sm font-medium">{{ ft("funMeter.jpeg.label", "Kualitas JPEG") }}</Label>
              <Input
                v-model.number="settings.form.funJpegQuality"
                type="number"
                step="0.05"
                min="0.1"
                max="1"
                class="h-9" />
              <p class="text-xs text-muted-foreground">
                {{
                  ft(
                    "funMeter.jpeg.help",
                    "Antara 0.1 - 1.0. Nilai tinggi lebih tajam namun ukuran data lebih besar."
                  )
                }}
              </p>
            </label>
            <label class="space-y-2 col-span-full">
              <Label class="text-sm font-medium">{{
                ft("funMeter.interval.label", "Interval Attendance & FunMeter (ms)")
              }}</Label>
              <Input v-model.number="settings.form.baseInterval" type="number" min="10" max="5000" class="h-9" />
              <p class="text-xs text-muted-foreground">
                {{ ft("funMeter.interval.help", "Default: 200. Jeda antar frame ke server attendance.") }}
              </p>
            </label>
          </div>
        </section>

        <div class="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium"
            @click="settings?.reset()">
            {{ ft("actions.reset", "Atur Ulang ke Bawaan") }}
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium"
            @click="settings?.closeModal()">
            {{ ft("actions.cancel", "Batal") }}
          </button>
          <button
            type="submit"
            class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:opacity-90">
            {{ ft("actions.save", "Simpan") }}
          </button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
